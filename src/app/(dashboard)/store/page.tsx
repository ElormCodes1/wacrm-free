"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Store as StoreIcon,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Info,
  EyeOff,
  Eye,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

interface Product {
  id: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  isHidden?: boolean;
  image?: string;
}

// WhatsApp catalog shapes vary — pull products out defensively.
function extractProducts(catalog: unknown): Product[] {
  if (!catalog || typeof catalog !== "object") return [];
  const c = catalog as Record<string, unknown>;
  const raw =
    (c.products as unknown[]) ??
    (c.catalog as unknown[]) ??
    (Array.isArray((c.collections as Record<string, unknown>[])?.[0]?.products)
      ? ((c.collections as Record<string, unknown>[])[0].products as unknown[])
      : []) ??
    [];
  const list = Array.isArray(raw) ? raw : [];
  return list.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const price =
      typeof o.price === "number"
        ? o.price
        : typeof o.priceAmount1000 === "number"
          ? (o.priceAmount1000 as number) / 1000
          : undefined;
    // getCatalog returns images as `imageUrls: { requested, original }`.
    const imageUrls = o.imageUrls as { requested?: string; original?: string } | undefined;
    const image =
      imageUrls?.original ??
      imageUrls?.requested ??
      (o.imageUrl as string) ??
      (o.image as string) ??
      ((o.productImageCollection as Record<string, unknown>[])?.[0]?.url as string) ??
      ((o.images as Record<string, unknown>[])?.[0]?.url as string) ??
      undefined;
    return {
      id: (o.id as string) ?? (o.productId as string) ?? "",
      name: (o.name as string) ?? "Product",
      description: o.description as string | undefined,
      price,
      currency: o.currency as string | undefined,
      isHidden: o.isHidden as boolean | undefined,
      image,
    };
  });
}

export default function StorePage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [isBusiness, setIsBusiness] = useState<boolean | null>(null);
  const [formFor, setFormFor] = useState<Product | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/store");
      const data = await res.json();
      if (!res.ok) {
        setProducts([]);
        setIsBusiness(false);
        return;
      }
      setIsBusiness(!!data.isBusiness);
      setProducts(extractProducts(data.catalog));
    } catch {
      setProducts([]);
      setIsBusiness(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = useCallback(
    async (p: Product) => {
      if (!window.confirm(`Delete "${p.name}" from your catalog?`)) return;
      setProducts((prev) => prev?.filter((x) => x.id !== p.id) ?? prev);
      const res = await fetch(`/api/whatsapp/store/${encodeURIComponent(p.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Delete failed");
        load();
      } else {
        toast.success("Product deleted");
      }
    },
    [load],
  );

  // Hide / show a product on WhatsApp (isHidden). The server re-sends the
  // product with its current image, so no re-upload here.
  const toggleHidden = useCallback(async (p: Product) => {
    const next = !p.isHidden;
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/whatsapp/store/${encodeURIComponent(p.id)}/hidden`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Update failed");
        return;
      }
      setProducts((prev) => prev?.map((x) => (x.id === p.id ? { ...x, isHidden: next } : x)) ?? prev);
      toast.success(next ? "Product hidden from your catalog" : "Product is visible again");
    } finally {
      setBusyId(null);
    }
  }, []);

  // Post the product to the Business number's WhatsApp Status (Stories).
  const shareToStatus = useCallback(async (p: Product) => {
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/whatsapp/store/${encodeURIComponent(p.id)}/share-status`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Couldn't share to status");
        return;
      }
      toast.success("Shared to your WhatsApp status");
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Store</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your WhatsApp catalog — products your customers browse and buy.
          </p>
        </div>
        <Button onClick={() => setFormFor("new")}>
          <Plus className="h-4 w-4" />
          Add product
        </Button>
      </div>

      {isBusiness === false && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-200/90">
            This number isn&apos;t a <strong>WhatsApp Business</strong> account, so
            products can&apos;t be created or edited yet. Switch the connected
            number to WhatsApp Business (in the phone&apos;s WhatsApp app) to use
            the catalog — everything here is ready the moment you do.
          </p>
        </div>
      )}

      {products === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : products.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 p-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <StoreIcon className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">No products yet</p>
          {isBusiness ? (
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Add your <strong>first</strong> product in the WhatsApp Business app
              (Settings → Business tools → Catalog). WhatsApp only lets apps like
              this manage a catalog once it&apos;s been started there — after that,
              add / edit / delete products right here.
            </p>
          ) : (
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Add products to build the catalog customers see in your WhatsApp chat.
            </p>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex h-36 items-center justify-center bg-muted">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <StoreIcon className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-1 flex-col p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">
                    {p.name}
                    {p.isHidden && (
                      <EyeOff className="h-3 w-3 text-muted-foreground" aria-label="Hidden" />
                    )}
                  </p>
                  {p.price != null && (
                    <span className="shrink-0 text-sm font-medium text-primary">
                      {p.currency ? `${p.currency} ` : ""}
                      {p.price.toLocaleString()}
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {p.description}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setFormFor(p)} className="flex-1">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === p.id}
                    title="Share to WhatsApp status"
                    onClick={() => shareToStatus(p)}
                  >
                    {busyId === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Share2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === p.id}
                    title={p.isHidden ? "Show in catalog" : "Hide from catalog"}
                    onClick={() => toggleHidden(p)}
                  >
                    {p.isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => remove(p)} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ProductSheet target={formFor} onClose={() => setFormFor(null)} onSaved={load} />
    </div>
  );
}

function ProductSheet({
  target,
  onClose,
  onSaved,
}: {
  target: Product | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target && target !== "new" ? target : null;
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!target) return;
    setName(editing?.name ?? "");
    setPrice(editing?.price != null ? String(editing.price) : "");
    setCurrency(editing?.currency ?? "GHS");
    setDescription(editing?.description ?? "");
    setImage(editing?.image ?? "");
  }, [target, editing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function save() {
    const priceNum = Number(price);
    if (!name.trim() || Number.isNaN(priceNum) || !currency.trim()) {
      toast.error("Name, price and currency are required");
      return;
    }
    if (!editing && !image.trim()) {
      toast.error("An image URL is required");
      return;
    }
    setSaving(true);
    const payload = {
      name,
      price: priceNum,
      currency,
      description,
      images: image.trim() ? [image.trim()] : [],
    };
    const res = editing
      ? await fetch(`/api/whatsapp/store/${encodeURIComponent(editing.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/whatsapp/store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to save product");
      return;
    }
    toast.success(editing ? "Product updated" : "Product added");
    onClose();
    onSaved();
  }

  return (
    <Sheet open={!!target} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full border-border bg-popover p-0 sm:max-w-md">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle>{editing ? "Edit product" : "Add product"}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="border-border bg-muted" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Price</Label>
                <Input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="border-border bg-muted"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Currency</Label>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="border-border bg-muted"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[80px] border-border bg-muted"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Image URL</Label>
              <Input
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://…/product.jpg"
                className="border-border bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                A public image URL. WhatsApp requires at least one image per product.
              </p>
            </div>
          </div>
          <div className="flex gap-2 border-t border-border/50 p-4">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !name.trim()} className="flex-1">
              {saving ? "Saving..." : editing ? "Save changes" : "Add product"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
