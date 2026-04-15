"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Actor } from "@/lib/api";

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when user presses Enter (when no autocomplete is open). */
  onSubmit: () => void;
  /** Full actor list. Only `type='agent'` actors are mentionable — humans
   *  are filtered out because the API mention parser only wakes agents. */
  actors: Actor[];
  placeholder?: string;
  className?: string;
  /** Optional ref so the parent can focus the input. */
  inputRef?: React.RefObject<HTMLInputElement>;
}

/**
 * Single-line text input with @-mention autocomplete.
 *
 * Behaviour:
 * - Type `@` and a dropdown appears showing matching agents.
 * - As you keep typing, the list filters by prefix (case-insensitive).
 * - ↑/↓ navigate, Enter or Tab selects the highlighted match, Esc closes.
 * - Selecting inserts `@<name> ` at the cursor and dismisses the dropdown.
 * - Enter with no dropdown open submits the comment (calls onSubmit).
 * - Mention parser regex on the API is /@([\w-]+)/ — only word characters
 *   and `-`. We use the same character set to detect when the user has
 *   moved past the mention (e.g. typed a space).
 */
export default function MentionInput({
  value,
  onChange,
  onSubmit,
  actors,
  placeholder = "Write a comment...",
  className = "",
  inputRef: externalRef,
}: MentionInputProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // Position in the value string of the `@` that started the active mention.
  const [mentionStart, setMentionStart] = useState<number | null>(null);

  // Mentionable actors — agents only.
  const agents = useMemo(
    () => actors.filter((a) => a.type === "agent"),
    [actors],
  );

  // Compute the current mention query (whatever's between @ and the cursor).
  const query = useMemo(() => {
    if (mentionStart === null) return "";
    const cursor = inputRef.current?.selectionStart ?? value.length;
    return value.slice(mentionStart + 1, cursor);
  }, [value, mentionStart, inputRef]);

  // Filtered list of suggestions.
  const suggestions = useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    const matches = agents
      .filter((a) => a.name.toLowerCase().startsWith(q))
      .slice(0, 8);
    // Fall back to substring match if prefix matched nothing
    if (matches.length === 0 && q.length > 0) {
      return agents
        .filter((a) => a.name.toLowerCase().includes(q))
        .slice(0, 8);
    }
    return matches;
  }, [open, agents, query]);

  // Reset highlight when suggestion list changes
  useEffect(() => {
    setHighlighted(0);
  }, [suggestions.length, open]);

  // Track cursor + value to update mention state.
  // Called from the input onChange — we get the new value here, the cursor
  // is read from the DOM in the next tick.
  const handleChange = (newValue: string) => {
    onChange(newValue);
    // Use rAF so the DOM has applied the new value and selectionStart
    requestAnimationFrame(() => {
      const cursor = inputRef.current?.selectionStart ?? newValue.length;
      // Look backwards from cursor for an @, stopping at any non-mention char
      let i = cursor - 1;
      let found: number | null = null;
      while (i >= 0) {
        const ch = newValue[i];
        if (ch === "@") {
          // @ must be at start, or preceded by whitespace
          if (i === 0 || /\s/.test(newValue[i - 1])) {
            found = i;
          }
          break;
        }
        // Mention chars: word chars and `-`. Anything else means the user
        // typed past the mention (e.g. a space) — abort.
        if (!/[\w-]/.test(ch)) break;
        i--;
      }
      if (found !== null) {
        setMentionStart(found);
        setOpen(true);
      } else {
        setMentionStart(null);
        setOpen(false);
      }
    });
  };

  // Insert the selected agent at the mention position.
  const acceptSuggestion = (agentName: string) => {
    if (mentionStart === null) return;
    const cursor = inputRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(cursor);
    const insertion = `@${agentName} `;
    const newValue = before + insertion + after;
    onChange(newValue);
    setOpen(false);
    setMentionStart(null);
    // Restore focus and place cursor right after the inserted mention
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const newCursor = before.length + insertion.length;
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(suggestions[highlighted].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setMentionStart(null);
        return;
      }
    }
    // No dropdown open — Enter submits
    if (e.key === "Enter" && !e.shiftKey && value.trim()) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative flex-1">
      <span className="text-sm">Mention to wake the agent up</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay so click on suggestion fires first
          setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 bg-gray-800 border border-gray-700 rounded shadow-lg overflow-hidden z-50 min-w-[200px]">
          {suggestions.map((agent, i) => (
            <button
              key={agent.id}
              type="button"
              onMouseDown={(e) => {
                // mousedown so it fires before the input's onBlur
                e.preventDefault();
                acceptSuggestion(agent.name);
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                i === highlighted
                  ? "bg-blue-900/40 text-blue-200"
                  : "text-gray-200 hover:bg-gray-700"
              }`}
            >
              <span>@{agent.name}</span>
              {agent.role && (
                <span className="text-xs text-gray-500">({agent.role})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
