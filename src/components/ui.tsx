import { useEffect, useRef, type ReactNode } from 'react';
import { X, AlertCircle, LoaderCircle } from 'lucide-react';
export function Status({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'amber' | 'green' | 'red' | 'blue';
}) {
  return (
    <span className={`status status-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : undefined}>
      <AlertCircle size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-loading" role="status">
      <LoaderCircle size={17} className="spin" />
      {label}
    </span>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const root = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = root.current;
    const before = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      before?.focus();
    };
  }, []);
  return (
    <dialog
      ref={root}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === root.current) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-header">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
