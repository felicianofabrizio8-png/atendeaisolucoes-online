export function RichText({ text }: { text: string }) {
  return <>{text.split("\n").map((line, index) => <span key={`${index}-${line}`} className="block">{line}</span>)}</>;
}
