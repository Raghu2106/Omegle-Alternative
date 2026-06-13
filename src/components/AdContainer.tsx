import { useEffect, useRef } from "react";

interface AdContainerProps {
  idKey: string;
  format?: string;
  height: number;
  width: number;
  className?: string;
}

export default function AdContainer({ idKey, format = "iframe", height, width, className = "" }: AdContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous elements
    containerRef.current.innerHTML = "";

    // Create configuration script
    const scriptConf = document.createElement("script");
    scriptConf.type = "text/javascript";
    scriptConf.innerHTML = `
      atOptions = {
        'key' : '${idKey}',
        'format' : '${format}',
        'height' : ${height},
        'width' : ${width},
        'params' : {}
      };
    `;

    // Create the loading script
    const scriptSrc = document.createElement("script");
    scriptSrc.type = "text/javascript";
    scriptSrc.src = `//eternalwheeled.com/${idKey}/invoke.js`;

    // Append both to container
    containerRef.current.appendChild(scriptConf);
    containerRef.current.appendChild(scriptSrc);

    return () => {
      // Clean up DOM on unmount
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [idKey, format, height, width]);

  return (
    <div 
      className={`relative flex items-center justify-center text-center overflow-hidden shrink-0 ${className}`}
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      <div ref={containerRef} className="w-full h-full flex items-center justify-center" />
    </div>
  );
}
