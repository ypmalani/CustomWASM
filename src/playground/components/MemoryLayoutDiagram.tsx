/**
 * Visual summary of the bump-allocator linear memory layout
 * (architecture.md §7).
 */
export function MemoryLayoutDiagram() {
  return (
    <div data-testid="memory-layout-diagram" className="space-y-4">
      <h3 className="font-sans text-sm font-semibold text-fg">
        Linear memory layout
      </h3>
      <p className="font-sans text-xs text-muted">
        Bump allocator: 1 page (64 KiB) initially, growable. Address 0 is kept
        invalid as a null marker. Objects are length-prefixed and 8-byte aligned.
      </p>

      <svg
        viewBox="0 0 640 220"
        role="img"
        aria-label="Linear memory map from reserved region through heap"
        className="w-full max-w-2xl rounded border border-rule bg-panel"
      >
        {/* Reserved */}
        <rect x="16" y="24" width="100" height="56" fill="#243041" rx="3" />
        <text
          x="66"
          y="48"
          textAnchor="middle"
          fill="#E8EDF5"
          fontSize="11"
          fontFamily="IBM Plex Sans, sans-serif"
        >
          Reserved
        </text>
        <text
          x="66"
          y="64"
          textAnchor="middle"
          fill="#6B7C93"
          fontSize="10"
          fontFamily="IBM Plex Mono, monospace"
        >
          0x0000–0x03FF
        </text>

        {/* Static data */}
        <rect x="124" y="24" width="160" height="56" fill="#2A3F55" rx="3" />
        <text
          x="204"
          y="48"
          textAnchor="middle"
          fill="#8BA4C7"
          fontSize="11"
          fontFamily="IBM Plex Sans, sans-serif"
        >
          Static data
        </text>
        <text
          x="204"
          y="64"
          textAnchor="middle"
          fill="#6B7C93"
          fontSize="10"
          fontFamily="IBM Plex Mono, monospace"
        >
          strings from 0x0400
        </text>

        {/* Heap */}
        <rect x="292" y="24" width="320" height="56" fill="#1A3D32" rx="3" />
        <text
          x="452"
          y="48"
          textAnchor="middle"
          fill="#4ADEA8"
          fontSize="11"
          fontFamily="IBM Plex Sans, sans-serif"
        >
          Bump heap
        </text>
        <text
          x="452"
          y="64"
          textAnchor="middle"
          fill="#6B7C93"
          fontSize="10"
          fontFamily="IBM Plex Mono, monospace"
        >
          heapBase → … ($hp advances)
        </text>

        {/* Arrow labels */}
        <line
          x1="292"
          y1="90"
          x2="292"
          y2="120"
          stroke="#8BA4C7"
          strokeWidth="1"
        />
        <text
          x="292"
          y="136"
          textAnchor="middle"
          fill="#8BA4C7"
          fontSize="10"
          fontFamily="IBM Plex Mono, monospace"
        >
          heapBase
        </text>
        <line
          x1="400"
          y1="90"
          x2="400"
          y2="120"
          stroke="#E8A87C"
          strokeWidth="1"
        />
        <text
          x="400"
          y="136"
          textAnchor="middle"
          fill="#E8A87C"
          fontSize="10"
          fontFamily="IBM Plex Mono, monospace"
        >
          $hp
        </text>

        {/* Object layouts */}
        <text
          x="16"
          y="168"
          fill="#E8EDF5"
          fontSize="11"
          fontWeight="600"
          fontFamily="IBM Plex Sans, sans-serif"
        >
          Object headers
        </text>
        <text
          x="16"
          y="188"
          fill="#6B7C93"
          fontSize="10"
          fontFamily="IBM Plex Mono, monospace"
        >
          string: [ length:i32 ][ bytes:u8 × length ]
        </text>
        <text
          x="16"
          y="206"
          fill="#6B7C93"
          fontSize="10"
          fontFamily="IBM Plex Mono, monospace"
        >
          array&lt;T&gt;: [ length:i32 ][ elements:T × length ] (i32 stride 4, f64
          stride 8)
        </text>
      </svg>
    </div>
  );
}
