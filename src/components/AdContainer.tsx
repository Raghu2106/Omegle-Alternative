import { useId } from "react";

interface AdContainerProps {
  idKey: string;
  format?: string;
  height: number;
  width: number;
  className?: string;
  placeholderLabel?: string;
}

export default function AdContainer({ idKey, format = "iframe", height, width, className = "", placeholderLabel }: AdContainerProps) {
  const iframeId = useId();

  // If no key is provided, show a beautiful professional placeholder slot to let the user know what is required
  if (!idKey || idKey === "placeholder") {
    return (
      <div 
        className={`relative flex flex-col items-center justify-center text-center overflow-hidden shrink-0 bg-slate-50 border border-dashed border-slate-200 rounded-lg p-1 ${className}`}
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <span className="text-[8px] font-extrabold text-slate-400 tracking-wider uppercase leading-none">Sponsored</span>
        <span className="text-[9px] font-semibold text-indigo-500 block leading-tight mt-0.5">{placeholderLabel || "Waiting for unit key"}</span>
        <span className="text-[8px] text-slate-400 font-mono mt-0.5 leading-none">{width} x {height}</span>
      </div>
    );
  }

  // The srcDoc allows the execution of script-based banner ads inside a completely 
  // isolated DOM context. This solves the major issue where document.currentScript is 
  // null during dynamic mounting of scripts in single-page apps (React/Vite).
  const srcDocHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: transparent;
          }
        </style>
      </head>
      <body>
        <div id="ad-wrapper" style="width: ${width}px; height: ${height}px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
          <script type="text/javascript">
            window.atOptions = {
              'key' : '${idKey}',
              'format' : '${format}',
              'height' : ${height},
              'width' : ${width},
              'params' : {}
            };
          </script>
          <script type="text/javascript" src="//eternalwheeled.com/${idKey}/invoke.js"></script>
        </div>
      </body>
    </html>
  `;

  return (
    <div 
      className={`relative flex items-center justify-center text-center overflow-hidden shrink-0 ${className}`}
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      <iframe
        id={iframeId}
        title={`ad-${idKey}`}
        srcDoc={srcDocHtml}
        width={width}
        height={height}
        style={{ border: "none", overflow: "hidden", width: `${width}px`, height: `${height}px` }}
        scrolling="no"
        frameBorder="0"
      />
    </div>
  );
}
