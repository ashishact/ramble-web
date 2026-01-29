import React, { useEffect, useState, useRef } from 'react';
import type { Direction } from './types';

interface ResizerProps {
  direction: Direction;
  onResizeStart: () => void;
  onResize: (offset: number) => void;
  onResizeEnd: () => void;
}

export const Resizer: React.FC<ResizerProps> = ({ direction, onResizeStart, onResize, onResizeEnd }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef<number>(0);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const offset = currentPos - startPosRef.current;
      onResize(offset);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, onResize, onResizeEnd]);

  const cursorClass = direction === 'horizontal' ? 'cursor-col-resize' : 'cursor-row-resize';
  const sizeClass = direction === 'horizontal' ? 'w-1 h-full' : 'h-1 w-full';

  return (
    <div
      className={`relative z-10 flex-none bg-slate-200/50 hover:bg-blue-400 transition-colors duration-200 ${cursorClass} ${sizeClass} ${isDragging ? 'bg-blue-500 scale-x-125 scale-y-125 shadow-sm' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
        setIsDragging(true);
        onResizeStart();
      }}
    >
      <div
        className={`absolute ${direction === 'horizontal' ? '-left-2 -right-2 top-0 bottom-0' : '-top-2 -bottom-2 left-0 right-0'}`}
      />
    </div>
  );
};