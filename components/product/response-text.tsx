/** Render only our verified PubMed citation URLs as links. No arbitrary model
 * HTML, markdown, executable URLs or broad auto-linking of private wording. */
export function ResponseText({ text }: { text: string }) {
  return <span style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
    {text.split(/(https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/)/g).map((part, index) =>
      /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/.test(part)
        ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">View source on PubMed</a>
        : part,
    )}
  </span>;
}
