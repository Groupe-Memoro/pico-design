import { fontPickerGroups } from "@/lib/design/fonts";

// Options d'un <select> de police : les 25 plus populaires de Google Fonts,
// puis toutes les autres (voir fontPickerGroups). Calculées une fois.
let groups: ReturnType<typeof fontPickerGroups> | null = null;

export default function FontSelectOptions() {
  groups ??= fontPickerGroups();
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
