export function TopBar() {
  return (
    <div className="flex items-center justify-between">
      <div className="grid grid-cols-2 gap-[3px]">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="size-[10px] rounded-full bg-kmr-blue" />
        ))}
      </div>
      <span className="font-mono text-[10px] font-semibold tracking-[1px] text-kmr-blue">
        KMR / <span className="text-kmr-orange">LIVE</span>
      </span>
    </div>
  );
}
