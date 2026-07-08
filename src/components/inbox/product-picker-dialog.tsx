"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Store as StoreIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PickProduct {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  image?: string;
}

// Mirror the Store page's defensive extraction (getCatalog returns products
// under `catalog`, images as `imageUrls.{original,requested}`).
function extract(catalog: unknown): PickProduct[] {
  if (!catalog || typeof catalog !== "object") return [];
  const c = catalog as Record<string, unknown>;
  const raw = (c.catalog as unknown[]) ?? (c.products as unknown[]) ?? [];
  const list = Array.isArray(raw) ? raw : [];
  return list.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const imageUrls = o.imageUrls as { requested?: string; original?: string } | undefined;
    return {
      id: (o.id as string) ?? (o.productId as string) ?? "",
      name: (o.name as string) ?? "Product",
      price: typeof o.price === "number" ? (o.price as number) : undefined,
      currency: o.currency as string | undefined,
      image: imageUrls?.original ?? imageUrls?.requested ?? (o.imageUrl as string) ?? undefined,
    };
  });
}

/**
 * Pick a catalog product and send it to the current conversation as a
 * native WhatsApp product card (via /api/whatsapp/send-product).
 */
export function ProductPickerDialog({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [products, setProducts] = useState<PickProduct[] | null>(null);
  const [notBusiness, setNotBusiness] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProducts(null);
    setNotBusiness(false);
    fetch("/api/whatsapp/store")
      .then((r) => r.json())
      .then((d) => {
        setNotBusiness(!d.isBusiness);
        setProducts(extract(d.catalog));
      })
      .catch(() => setProducts([]));
  }, [open]);

  async function pick(p: PickProduct) {
    setSending(p.id);
    try {
      const res = await fetch("/api/whatsapp/send-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, product_id: p.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Couldn't send product");
        return;
      }
      toast.success("Product sent");
      onClose();
    } finally {
      setSending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StoreIcon className="h-4 w-4" /> Send a product
          </DialogTitle>
        </DialogHeader>

        {products === null ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : notBusiness ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No WhatsApp Business catalog is connected. Connect a Business number
            and add products to share them here.
          </p>
        ) : products.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Your catalog has no products yet.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {products.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={sending !== null}
                  onClick={() => pick(p)}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted disabled:opacity-50"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <StoreIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                    {typeof p.price === "number" && (
                      <p className="text-xs text-primary">
                        {p.currency ? `${p.currency} ` : ""}
                        {p.price.toLocaleString()}
                      </p>
                    )}
                  </div>
                  {sending === p.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
