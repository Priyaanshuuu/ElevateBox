export function FauxPane({
  label,
  rows,
  bars,
}: {
  label: string;
  rows: [string, string][];
  bars: number[];
}) {
  return (
    <div className="faux-pane">
      <div className="faux-pane-chrome">
        <span className="faux-pane-dots"><i /><i /></span>
        <span>{label}</span>
      </div>
      <div className="faux-pane-body">
        {rows.map(([name, value], index) => (
          <div className="faux-pane-row" key={name}>
            <span className="faux-pane-name">{name}</span>
            <span className="faux-pane-value">{value}</span>
            <span className="faux-pane-bar" style={{ width: `${bars[index]}%` }} />
          </div>
        ))}
        <div className="faux-pane-row quiet">
          <span className="faux-pane-bar" style={{ width: `${bars[2]}%` }} />
          <span className="faux-pane-bar" style={{ width: `${bars[3]}%` }} />
        </div>
      </div>
    </div>
  );
}
