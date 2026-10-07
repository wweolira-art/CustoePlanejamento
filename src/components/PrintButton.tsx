type Props = {
  label?: string;
};

export function PrintButton({ label = "Imprimir" }: Props) {
  return (
    <button type="button" className="btn no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
