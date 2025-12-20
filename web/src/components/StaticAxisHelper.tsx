export default function StaticAxisHelper() {
  return (
    <div className="absolute top-4 left-4 w-24 h-24">
      <svg viewBox="0 0 100 100" className="w-full h-full" role="img" aria-label="Static axis helper">
        <title>Static axis helper</title>
        {/* X-axis (red) */}
        <line x1="10" y1="90" x2="90" y2="90" stroke="red" strokeWidth="2" />
        <text x="90" y="95" fill="red" fontSize="15">
          X
        </text>

        {/* Y-axis (green) */}
        <line x1="10" y1="90" x2="10" y2="20" stroke="green" strokeWidth="2" />
        <text x="5" y="10" fill="green" fontSize="15">
          Y
        </text>

        {/* Z-axis (blue) */}
        <line x1="10" y1="90" x2="50" y2="50" stroke="blue" strokeWidth="2" />
        <text x="55" y="45" fill="#5a5affff" fontSize="15">
          Z
        </text>
      </svg>
    </div>
  );
}
