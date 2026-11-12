export default function Filter({ label }: { label: string }) {
  return <button className="filter-btn">{label}<span>⌄</span></button>;
}
