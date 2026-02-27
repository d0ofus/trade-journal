"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

function runCmd(command: string) {
  document.execCommand(command, false);
}

export function RichTextEditor({ value, onChange, placeholder }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!focusedRef.current && editor.innerHTML !== value) {
      editor.innerHTML = value || "";
    }
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => runCmd("bold")}>B</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => runCmd("italic")}>I</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => runCmd("insertUnorderedList")}>List</Button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        dir="ltr"
        suppressContentEditableWarning
        className="min-h-28 rounded-md border border-slate-300 bg-white p-3 text-left text-sm"
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (editorRef.current && editorRef.current.innerHTML !== value) {
            onChange(editorRef.current.innerHTML);
          }
        }}
        onInput={(event) => {
          const html = (event.currentTarget as HTMLDivElement).innerHTML;
          onChange(html);
        }}
        data-placeholder={placeholder ?? "Add note..."}
      />
    </div>
  );
}
