// features/files/CreateInput.tsx
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MONO } from "../../design";
import { FileIcon } from "./FileIcon";

interface Props {
  parentPath: string;
  type:       "file" | "folder";
  depth?:     number;
  onDone:     () => void;
  onCancel:   () => void;
}

export function CreateInput({ parentPath, type, depth = 0, onDone, onCancel }: Props) {
  const [name, setName] = useState("");
  const inputRef   = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onCancel();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 100);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onCancel]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { onCancel(); return; }
    const sep = parentPath.includes("\\") ? "\\" : "/";
    try {
      if (type === "folder") await invoke("fs_create_dir",  { path: `${parentPath}${sep}${trimmed}` });
      else                   await invoke("fs_create_file", { path: `${parentPath}${sep}${trimmed}` });
    } catch (e) { alert(`Create failed: ${e}`); }
    onDone();
  };

  return (
    <div ref={wrapperRef} style={{
      display: "flex", alignItems: "center", gap: 5,
      paddingLeft: 8 + depth * 14 + 18, paddingRight: 8,
      paddingTop: 2, paddingBottom: 2,
      background: "rgba(9,71,113,.25)",
    }}>
      <FileIcon name={type === "folder" ? "folder" : (name || "file")} isDir={type === "folder"} />
      <input
        ref={inputRef} value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        placeholder={type === "folder" ? "folder name" : "file name"}
        style={{
          flex: 1, background: "#3c3c3c", border: "1px solid #007fd4",
          borderRadius: 3, color: "#cccccc", fontSize: 12,
          fontFamily: MONO, padding: "1px 6px", outline: "none", height: 20,
        }}
      />
    </div>
  );
}