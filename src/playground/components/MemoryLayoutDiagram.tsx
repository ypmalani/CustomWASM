/**
 * Visual summary of the bump-allocator linear memory layout
 * (architecture.md §7).
 */
export function MemoryLayoutDiagram() {
  return (
    <div data-testid="memory-layout-diagram" className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-200">
        Linear memory layout
      </h3>
      <p className="text-xs text-slate-400">
        Bump allocator: 1 page (64 KiB) initially, growable. Address 0 is kept
        invalid as a null marker. Objects are length-prefixed and 8-byte aligned.
      </p>

      <svg
        viewBox="0 0 640 220"
        role="img"
        aria-label="Linear memory map from reserved region through heap"
        className="w-full max-w-2xl rounded border border-slate-700 bg-slate-900"
      >
        {/* Reserved */}
        <rect x="16" y="24" width="100" height="56" fill="#334155" rx="4" />
        <text x="66" y="48" textAnchor="middle" fill="#e2e8f0" fontSize="11">
          Reserved
        </text>
        <text x="66" y="64" textAnchor="middle" fill="#94a3b8" fontSize="10">
          0x0000–0x03FF
        </text>

        {/* Static data */}
        <rect x="124" y="24" width="160" height="56" fill="#0e7490" rx="4" />
        <text x="204" y="48" textAnchor="middle" fill="#ecfeff" fontSize="11">
          Static data
        </text>
        <text x="204" y="64" textAnchor="middle" fill="#a5f3fc" fontSize="10">
          strings from 0x0400
        </text>

        {/* Heap */}
        <rect x="292" y="24" width="320" height="56" fill="#166534" rx="4" />
        <text x="452" y="48" textAnchor="middle" fill="#dcfce7" fontSize="11">
          Bump heap
        </text>
        <text x="452" y="64" textAnchor="middle" fill="#86efac" fontSize="10">
          heapBase → … ($hp advances)
        </text>

        {/* Arrow labels */}
        <line
          x1="292"
          y1="90"
          x2="292"
          y2="120"
          stroke="#94a3b8"
          strokeWidth="1"
        />
        <text x="292" y="136" textAnchor="middle" fill="#cbd5e1" fontSize="10">
          heapBase
        </text>
        <line
          x1="400"
          y1="90"
          x2="400"
          y2="120"
          stroke="#f87171"
          strokeWidth="1"
        />
        <text x="400" y="136" textAnchor="middle" fill="#fca5a5" fontSize="10">
          $hp
        </text>

        {/* Object layouts */}
        <text x="16" y="168" fill="#e2e8f0" fontSize="11" fontWeight="600">
          Object headers
        </text>
        <text x="16" y="188" fill="#94a3b8" fontSize="10">
          string: [ length:i32 ][ bytes:u8 × length ]
        </text>
        <text x="16" y="206" fill="#94a3b8" fontSize="10">
          array&lt;T&gt;: [ length:i32 ][ elements:T × length ] (i32 stride 4, f64
          stride 8)
        </text>
      </svg>
    </div>
  );
}
