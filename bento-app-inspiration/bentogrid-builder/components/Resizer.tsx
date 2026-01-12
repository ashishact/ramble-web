import React, { useEffect, useState } from 'react';
import { Direction } from '../types';

interface ResizerProps {
  direction: Direction;
  onResize: (delta: number) => void;
  onResizeEnd: () => void;
}

export const Resizer: React.FC<ResizerProps> = ({ direction, onResize, onResizeEnd }) => {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = direction === 'horizontal' ? e.movementX : e.movementY;
      onResize(delta);
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
        setIsDragging(true);
      }}
    >
      <div 
        className={`absolute ${direction === 'horizontal' ? '-left-2 -right-2 top-0 bottom-0' : '-top-2 -bottom-2 left-0 right-0'}`} 
      />
    </div>
  );
};