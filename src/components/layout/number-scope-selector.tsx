"use client";

import { Check, ChevronsUpDown, Phone } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useNumberScope } from "@/hooks/use-number-scope";

/**
 * Header control to scope the whole app to one WhatsApp number or all of
 * them. Hidden when the account has fewer than two linked numbers.
 */
export function NumberScopeSelector() {
  const { scope, setScope, numbers } = useNumberScope();

  if (numbers.length < 2) return null;

  const selected = numbers.find((n) => n.id === scope);
  const label = scope === "all" ? "All numbers" : selected?.label || "Number";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        title="Filter by WhatsApp number"
      >
        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[120px] truncate">{label}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 border-border bg-popover">
        <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
          WhatsApp number
        </div>
        <DropdownMenuItem onClick={() => setScope("all")} className="justify-between">
          <span>All numbers</span>
          {scope === "all" && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {numbers.map((n) => {
          const open = n.connection_state === "open";
          return (
            <DropdownMenuItem
              key={n.id}
              onClick={() => setScope(n.id)}
              className="justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    open ? "bg-positive" : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                <span className="truncate">{n.label || "Number"}</span>
              </span>
              {scope === n.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
