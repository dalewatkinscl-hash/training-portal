/**
 * Ambient layered background for Linear-style portal shells.
 */
export default function AmbientBackground({ className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at top, #0a0a0f 0%, #050506 50%, #020203 100%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
      <div className="absolute -top-40 left-1/2 h-[900px] w-[1400px] -translate-x-1/2 rounded-full bg-[#5E6AD2]/25 blur-[150px] motion-safe:animate-cl-float" />
      <div className="absolute top-1/3 -left-40 h-[800px] w-[600px] rounded-full bg-[#7C4DFF]/15 blur-[120px] motion-safe:animate-cl-float-delayed" />
      <div className="absolute bottom-0 right-0 h-[700px] w-[500px] rounded-full bg-[#5E6AD2]/12 blur-[100px] motion-safe:animate-cl-float" />
    </div>
  );
}
