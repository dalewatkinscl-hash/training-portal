'use strict';

/**
 * SharePoint / Microsoft Graph helpers for the Training site library.
 * Library: /sites/Training / Employee Training Documents
 * Layout: one folder per employee at the library root (First Last).
 */

const SHAREPOINT_HOST = 'countrylion.sharepoint.com';
const SHAREPOINT_SITE_PATH = '/sites/Training';
const DOCUMENT_LIBRARY_NAME = 'Employee Training Documents';

const INVALID_FILE_CHARS = /[\\/:*?"<>|]/g;

let tokenCache = { token: '', expiresAt: 0 };
let siteIdCache = '';
let driveIdCache = '';

function sanitizeFileName(fileName) {
  return String(fileName || 'document')
    .replace(INVALID_FILE_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'document';
}

function buildEmployeeFolderName(fullName) {
  return String(fullName || 'Unknown employee')
    .replace(INVALID_FILE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Unknown employee';
}

function normalizeFolderLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveEmployeeSharePointPaths(employee = {}) {
  const folderName = employee.trainingFolderName
    || employee.sharePointFolderName
    || buildEmployeeFolderName(employee.fullName);

  return {
    folderName,
    employeeFolderPath: folderName,
    trainingFolderPath: folderName,
    isConfirmed: Boolean(employee.trainingFolderConfirmedAt || employee.sharePointFolderConfirmedAt),
    usesMappedFolder: Boolean(employee.trainingFolderName || employee.sharePointFolderName),
  };
}

function encodeDrivePath(folderPath) {
  return folderPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function formatGraphError(method, path, status, errorBody) {
  if (status === 401 || status === 403) {
    return 'SharePoint access denied. Confirm MS Graph has access to the Training site (Sites.ReadWrite.All or Sites.Selected).';
  }
  return `Microsoft Graph ${method} ${path} failed (${status}): ${errorBody}`;
}

async function graphRequest(config, method, path, options = {}) {
  const token = await getGraphAccessToken(config);
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  if (options.contentType && !headers['Content-Type']) {
    headers['Content-Type'] = options.contentType;
  } else if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers,
    body: options.body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const error = new Error(formatGraphError(method, path, response.status, errorBody));
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  return response.json();
}

async function getGraphAccessToken(config) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Failed to obtain Microsoft Graph token.');
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };

  return tokenCache.token;
}

async function getSiteId(config) {
  if (siteIdCache) return siteIdCache;
  const site = await graphRequest(config, 'GET', `/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`);
  siteIdCache = site.id;
  return siteIdCache;
}

async function getDocumentLibraryDriveId(config) {
  if (driveIdCache) return driveIdCache;
  const siteId = await getSiteId(config);
  const drives = await graphRequest(config, 'GET', `/sites/${siteId}/drives`);
  const drive = (drives.value || []).find((item) => item.name === DOCUMENT_LIBRARY_NAME);
  if (!drive) {
    throw new Error(`SharePoint document library "${DOCUMENT_LIBRARY_NAME}" was not found on the Training site.`);
  }
  driveIdCache = drive.id;
  return driveIdCache;
}

async function getDriveItemByPath(config, driveId, itemPath) {
  const encodedPath = encodeDrivePath(itemPath);
  try {
    return await graphRequest(config, 'GET', `/drives/${driveId}/root:/${encodedPath}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function createFolder(config, driveId, parentPath, folderName) {
  const parentEndpoint = parentPath
    ? `/drives/${driveId}/root:/${encodeDrivePath(parentPath)}:/children`
    : `/drives/${driveId}/root/children`;

  return graphRequest(config, 'POST', parentEndpoint, {
    body: JSON.stringify({
      name: folderName,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });
}

async function ensureFolderPath(config, driveId, folderPath) {
  const segments = folderPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const segment of segments) {
    const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = await getDriveItemByPath(config, driveId, nextPath);
    if (!existing) {
      try {
        await createFolder(config, driveId, currentPath, segment);
      } catch (error) {
        const retry = await getDriveItemByPath(config, driveId, nextPath);
        if (!retry) throw error;
      }
    }
    currentPath = nextPath;
  }

  return getDriveItemByPath(config, driveId, currentPath);
}

async function uploadFileToFolder(config, driveId, folderPath, fileName, fileBuffer, mimeType) {
  const safeName = sanitizeFileName(fileName);
  const encodedFolder = encodeDrivePath(folderPath);
  const encodedFile = encodeURIComponent(safeName);

  return graphRequest(
    config,
    'PUT',
    `/drives/${driveId}/root:/${encodedFolder}/${encodedFile}:/content`,
    {
      body: fileBuffer,
      contentType: mimeType || 'application/octet-stream',
      headers: {},
    },
  );
}

async function listEmployeeFolders(config) {
  const driveId = await getDocumentLibraryDriveId(config);
  const folders = [];
  let url = `/drives/${driveId}/root/children?$select=id,name,folder,webUrl&$top=200`;

  while (url) {
    const path = url.startsWith('http')
      ? url.replace('https://graph.microsoft.com/v1.0', '')
      : url;
    const page = await graphRequest(config, 'GET', path);
    for (const item of page?.value || []) {
      if (item.folder) {
        folders.push({
          name: item.name,
          id: item.id,
          webUrl: item.webUrl || '',
        });
      }
    }
    url = page?.['@odata.nextLink'] || '';
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  return folders;
}

function scoreFolderMatch(employeeName, folderName) {
  const left = normalizeFolderLabel(employeeName);
  const right = normalizeFolderLabel(folderName);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (right.startsWith(left) || left.startsWith(right)) return 80;
  const leftParts = left.split(' ');
  const rightParts = right.split(' ');
  const overlap = leftParts.filter((part) => rightParts.includes(part)).length;
  if (overlap === 0) return 0;
  return Math.round((overlap / Math.max(leftParts.length, rightParts.length)) * 70);
}

function suggestEmployeeFolders(employeeName, folders = []) {
  return folders
    .map((folder) => ({
      ...folder,
      score: scoreFolderMatch(employeeName, folder.name),
    }))
    .filter((folder) => folder.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8);
}

async function ensureEmployeeFolder(config, employee = {}) {
  const paths = resolveEmployeeSharePointPaths(employee);
  const driveId = await getDocumentLibraryDriveId(config);
  const item = await ensureFolderPath(config, driveId, paths.employeeFolderPath);
  return {
    folderName: paths.folderName,
    folderPath: paths.employeeFolderPath,
    webUrl: item?.webUrl || '',
    id: item?.id || '',
    created: true,
  };
}

async function uploadTrainingCertificate(config, options) {
  const {
    fullName,
    sharePointFolderName,
    trainingFolderName,
    courseTitle,
    fileName,
    fileBuffer,
    mimeType,
  } = options;

  const paths = resolveEmployeeSharePointPaths({
    fullName,
    sharePointFolderName,
    trainingFolderName,
  });

  const courseFolder = sanitizeFileName(courseTitle || 'Training');
  const certificateFolderPath = `${paths.employeeFolderPath}/Certificates/${courseFolder}`;
  const resolvedFileName = sanitizeFileName(fileName || `${courseFolder}.pdf`);

  const driveId = await getDocumentLibraryDriveId(config);
  await ensureFolderPath(config, driveId, certificateFolderPath);

  const uploaded = await uploadFileToFolder(
    config,
    driveId,
    certificateFolderPath,
    resolvedFileName,
    fileBuffer,
    mimeType,
  );

  return {
    folderPath: certificateFolderPath,
    fileName: resolvedFileName,
    sharePointItemId: uploaded.id,
    sharePointWebUrl: uploaded.webUrl,
    sharePointDriveId: driveId,
  };
}

function isSharePointConfigured(config) {
  return Boolean(config?.tenantId && config?.clientId && config?.clientSecret);
}

function clearSharePointCaches() {
  tokenCache = { token: '', expiresAt: 0 };
  siteIdCache = '';
  driveIdCache = '';
}

module.exports = {
  DOCUMENT_LIBRARY_NAME,
  SHAREPOINT_HOST,
  SHAREPOINT_SITE_PATH,
  buildEmployeeFolderName,
  clearSharePointCaches,
  ensureEmployeeFolder,
  isSharePointConfigured,
  listEmployeeFolders,
  normalizeFolderLabel,
  resolveEmployeeSharePointPaths,
  scoreFolderMatch,
  suggestEmployeeFolders,
  uploadTrainingCertificate,
};
