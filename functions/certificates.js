'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO_PATH = path.join(__dirname, 'assets', 'country-lion-logo.png');

const COLOURS = {
  black: '#0a0a0a',
  ink: '#1a1a1a',
  muted: '#5c5c5c',
  soft: '#8a8a8a',
  gold: '#e8a317',
  goldDark: '#b8810f',
  cream: '#faf7f0',
  white: '#ffffff',
  line: '#d6c9a8',
};

function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function drawDoubleBorder(doc, pageWidth, pageHeight) {
  const outer = 18;
  const inner = 28;

  doc
    .lineWidth(2.5)
    .strokeColor(COLOURS.gold)
    .rect(outer, outer, pageWidth - outer * 2, pageHeight - outer * 2)
    .stroke();

  doc
    .lineWidth(0.8)
    .strokeColor(COLOURS.goldDark)
    .rect(inner, inner, pageWidth - inner * 2, pageHeight - inner * 2)
    .stroke();

  const corner = 10;
  const points = [
    [inner, inner],
    [pageWidth - inner, inner],
    [inner, pageHeight - inner],
    [pageWidth - inner, pageHeight - inner],
  ];
  points.forEach(([x, y]) => {
    doc
      .lineWidth(1.2)
      .strokeColor(COLOURS.gold)
      .moveTo(x - corner, y)
      .lineTo(x + corner, y)
      .moveTo(x, y - corner)
      .lineTo(x, y + corner)
      .stroke();
  });
}

function drawHeader(doc, pageWidth) {
  const headerTop = 36;
  const headerHeight = 92;

  doc
    .save()
    .rect(36, headerTop, pageWidth - 72, headerHeight)
    .fill(COLOURS.black);

  if (fs.existsSync(LOGO_PATH)) {
    const logoWidth = 340;
    const logoHeight = 72;
    const logoX = (pageWidth - logoWidth) / 2;
    const logoY = headerTop + (headerHeight - logoHeight) / 2;
    doc.image(LOGO_PATH, logoX, logoY, {
      width: logoWidth,
      height: logoHeight,
      fit: [logoWidth, logoHeight],
      align: 'center',
      valign: 'center',
    });
  } else {
    doc
      .fillColor(COLOURS.gold)
      .font('Helvetica-BoldOblique')
      .fontSize(28)
      .text('Country Lion', 56, headerTop + 28, {
        width: pageWidth - 112,
        align: 'center',
      });
    doc
      .fillColor('#9a9a9a')
      .font('Helvetica-Oblique')
      .fontSize(10)
      .text('(Northampton) Limited', 56, headerTop + 60, {
        width: pageWidth - 112,
        align: 'center',
      });
  }

  doc.restore();
  return headerTop + headerHeight;
}

function drawDivider(doc, y, pageWidth) {
  const left = 120;
  const right = pageWidth - 120;
  const mid = pageWidth / 2;

  doc
    .save()
    .strokeColor(COLOURS.line)
    .lineWidth(1)
    .moveTo(left, y)
    .lineTo(mid - 18, y)
    .moveTo(mid + 18, y)
    .lineTo(right, y)
    .stroke();

  doc
    .circle(mid, y, 3.5)
    .fill(COLOURS.gold);
  doc.restore();
}

/**
 * Build a branded Country Lion training certificate PDF.
 * @returns {Promise<Buffer>}
 */
function buildTrainingCertificatePdf({
  employeeName,
  courseTitle,
  completedAt,
  expiresAt,
  certificateId,
  sourceLabel,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 40, left: 48, right: 48 },
      info: {
        Title: `Training Certificate — ${courseTitle || 'Course'}`,
        Author: 'Country Lion (Northampton) Limited',
        Subject: `Certificate for ${employeeName || 'employee'}`,
      },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // Soft cream background inside the border
    doc
      .rect(28, 28, pageWidth - 56, pageHeight - 56)
      .fill(COLOURS.cream);

    drawDoubleBorder(doc, pageWidth, pageHeight);
    const headerBottom = drawHeader(doc, pageWidth);

    let y = headerBottom + 28;

    doc
      .fillColor(COLOURS.goldDark)
      .font('Helvetica')
      .fontSize(10)
      .text('TRAINING RECORDS', 56, y, {
        width: pageWidth - 112,
        align: 'center',
        characterSpacing: 3,
      });

    y += 22;
    doc
      .fillColor(COLOURS.ink)
      .font('Helvetica-Bold')
      .fontSize(30)
      .text('Certificate of Completion', 56, y, {
        width: pageWidth - 112,
        align: 'center',
      });

    y += 44;
    drawDivider(doc, y, pageWidth);

    y += 22;
    doc
      .fillColor(COLOURS.muted)
      .font('Helvetica-Oblique')
      .fontSize(12)
      .text('This is to certify that', 56, y, {
        width: pageWidth - 112,
        align: 'center',
      });

    y += 24;
    doc
      .fillColor(COLOURS.ink)
      .font('Helvetica-Bold')
      .fontSize(26)
      .text(employeeName || 'Employee', 56, y, {
        width: pageWidth - 112,
        align: 'center',
      });

    y += 36;
    doc
      .fillColor(COLOURS.muted)
      .font('Helvetica')
      .fontSize(12)
      .text('has successfully completed the training course', 56, y, {
        width: pageWidth - 112,
        align: 'center',
      });

    y += 24;
    doc
      .fillColor(COLOURS.goldDark)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(courseTitle || 'Training course', 80, y, {
        width: pageWidth - 160,
        align: 'center',
      });

    y += 42;
    drawDivider(doc, y, pageWidth);

    y += 22;
    const colWidth = 200;
    const colGap = 40;
    const metaBlockWidth = colWidth * 2 + colGap;
    const metaX = (pageWidth - metaBlockWidth) / 2;

    const metaItems = [
      { label: 'Completed', value: formatDate(completedAt) },
      { label: 'Valid until', value: formatDate(expiresAt) },
    ];

    metaItems.forEach((item, index) => {
      const x = metaX + index * (colWidth + colGap);
      doc
        .fillColor(COLOURS.soft)
        .font('Helvetica')
        .fontSize(9)
        .text(item.label.toUpperCase(), x, y, {
          width: colWidth,
          align: 'center',
          characterSpacing: 1.5,
        });
      doc
        .fillColor(COLOURS.ink)
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(item.value, x, y + 14, {
          width: colWidth,
          align: 'center',
        });
    });

    y += 52;
    doc
      .fillColor(COLOURS.soft)
      .font('Helvetica')
      .fontSize(9)
      .text(
        [
          sourceLabel ? `Source: ${sourceLabel}` : null,
          certificateId ? `Certificate ID: ${certificateId}` : null,
        ]
          .filter(Boolean)
          .join('   ·   ') || '',
        56,
        y,
        { width: pageWidth - 112, align: 'center' },
      );

    doc
      .fillColor(COLOURS.soft)
      .font('Helvetica')
      .fontSize(8)
      .text(
        'Country Lion (Northampton) Limited  ·  training.countrylion.co.uk',
        56,
        pageHeight - 52,
        { width: pageWidth - 112, align: 'center' },
      );

    doc.end();
  });
}

module.exports = {
  buildTrainingCertificatePdf,
  LOGO_PATH,
};
