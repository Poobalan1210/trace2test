import { Highlight, type PrismTheme } from 'prism-react-renderer';

// Tuned to the dashboard palette; every token colour clears 4.5:1 on #0B0E14.
const theme: PrismTheme = {
  plain: { color: '#E6E9EF', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment'], style: { color: '#8B93A3', fontStyle: 'italic' } },
    { types: ['string', 'template-string'], style: { color: '#A5D6A7' } },
    { types: ['number', 'boolean'], style: { color: '#F5C26B' } },
    { types: ['keyword', 'operator'], style: { color: '#9CB4F0' } },
    { types: ['function'], style: { color: '#F5A524' } },
    { types: ['punctuation'], style: { color: '#AEB5C2' } },
    { types: ['property', 'constant'], style: { color: '#C3CAD8' } },
  ],
};

export function CodeView({ code, language = 'javascript', label }: { code: string; language?: string; label: string }) {
  return (
    <Highlight code={code.replace(/\n$/, '')} language={language} theme={theme}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre aria-label={label} tabIndex={0} className="overflow-x-auto py-3 font-mono text-[12.5px] leading-[20px]">
          <code>
            {tokens.map((line, i) => {
              const { key: _k, ...lineProps } = getLineProps({ line, key: i }) as { key?: unknown };
              return (
                <div key={i} {...lineProps} className="table-row">
                  <span aria-hidden="true" className="table-cell select-none pl-3 pr-4 text-right text-muted tnum">{i + 1}</span>
                  <span className="table-cell pr-4">
                    {line.map((token, k) => {
                      const { key: _t, ...props } = getTokenProps({ token, key: k }) as { key?: unknown };
                      return <span key={k} {...props} />;
                    })}
                  </span>
                </div>
              );
            })}
          </code>
        </pre>
      )}
    </Highlight>
  );
}
