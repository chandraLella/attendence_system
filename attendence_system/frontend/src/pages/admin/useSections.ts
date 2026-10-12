import { sections } from "../../api/endpoints";
import { useAsync } from "../../lib/hooks";
export const useSections = () => { const r = useAsync(sections.list); return { sections: r.data ?? [], reloadSections: r.reload }; };
