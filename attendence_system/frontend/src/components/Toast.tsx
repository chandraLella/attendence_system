import { createContext, ReactNode, useCallback, useContext, useState } from "react";

type Kind = "" | "ok" | "err";
interface T { id: number; msg: string; kind: Kind }
const Ctx = createContext<{ toast: (msg: string, kind?: Kind) => void; fail: (e: unknown) => void }>(null!);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const toast = useCallback((msg: string, kind: Kind = "") => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "err" ? 7000 : 4000);
  }, []);
  const fail = useCallback((e: unknown) => toast(e instanceof Error ? e.message : String(e), "err"), [toast]);
  return (
    <Ctx.Provider value={{ toast, fail }}>
      {children}
      <div className="toasts" role="status">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </Ctx.Provider>
  );
}
