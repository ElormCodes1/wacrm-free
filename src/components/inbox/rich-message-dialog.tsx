"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X, LocateFixed } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type RichKind = "location" | "contact" | "poll";

const TITLES: Record<RichKind, string> = {
  location: "Send location",
  contact: "Send contact card",
  poll: "Create poll",
};

/**
 * Unified dialog for the richer WhatsApp message types. Collects the
 * minimal params for a location / contact / poll and POSTs to
 * /api/whatsapp/send-rich. The new message shows in the thread via
 * realtime.
 */
export function RichMessageDialog({
  conversationId,
  kind,
  onClose,
}: {
  conversationId: string;
  kind: RichKind | null;
  onClose: () => void;
}) {
  const [sending, setSending] = useState(false);

  // location
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");

  // contact
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cOrg, setCOrg] = useState("");

  // poll
  const [pollName, setPollName] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMulti, setPollMulti] = useState(false);

  const reset = () => {
    setLat(""); setLng(""); setLocName(""); setLocAddress("");
    setCName(""); setCPhone(""); setCOrg("");
    setPollName(""); setPollOptions(["", ""]); setPollMulti(false);
  };

  const close = () => { reset(); onClose(); };

  async function submit() {
    if (!kind) return;
    let payload: Record<string, unknown>;
    if (kind === "location") {
      const latN = Number(lat), lngN = Number(lng);
      if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
        toast.error("Enter a valid latitude and longitude.");
        return;
      }
      payload = { kind, latitude: latN, longitude: lngN, name: locName || undefined, address: locAddress || undefined };
    } else if (kind === "contact") {
      if (!cName.trim() || !cPhone.trim()) {
        toast.error("Name and phone are required.");
        return;
      }
      payload = { kind, contacts: [{ fullName: cName.trim(), phoneNumber: cPhone.replace(/\D/g, ""), organization: cOrg || undefined }] };
    } else {
      const values = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (!pollName.trim() || values.length < 2) {
        toast.error("A poll needs a question and at least 2 options.");
        return;
      }
      payload = { kind, name: pollName.trim(), values, selectableCount: pollMulti ? values.length : 1 };
    }

    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send-rich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Send failed");
        return;
      }
      toast.success("Sent");
      close();
    } catch {
      toast.error("Send failed");
    } finally {
      setSending(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      () => toast.error("Could not get your location."),
    );
  }

  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kind ? TITLES[kind] : ""}</DialogTitle>
        </DialogHeader>

        {kind === "location" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="lat">Latitude</Label>
                <Input id="lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="5.6037" />
              </div>
              <div>
                <Label htmlFor="lng">Longitude</Label>
                <Input id="lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-0.1870" />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={useMyLocation}>
              <LocateFixed className="mr-1 h-4 w-4" /> Use my location
            </Button>
            <div>
              <Label htmlFor="locname">Name (optional)</Label>
              <Input id="locname" value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Our office" />
            </div>
            <div>
              <Label htmlFor="locaddr">Address (optional)</Label>
              <Input id="locaddr" value={locAddress} onChange={(e) => setLocAddress(e.target.value)} placeholder="123 Main St" />
            </div>
          </div>
        )}

        {kind === "contact" && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="cname">Full name</Label>
              <Input id="cname" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div>
              <Label htmlFor="cphone">Phone (with country code)</Label>
              <Input id="cphone" value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="233241234567" />
            </div>
            <div>
              <Label htmlFor="corg">Organization (optional)</Label>
              <Input id="corg" value={cOrg} onChange={(e) => setCOrg(e.target.value)} placeholder="Acme Inc" />
            </div>
          </div>
        )}

        {kind === "poll" && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="pollq">Question</Label>
              <Input id="pollq" value={pollName} onChange={(e) => setPollName(e.target.value)} placeholder="What time works best?" />
            </div>
            <div className="space-y-2">
              <Label>Options</Label>
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={opt}
                    onChange={(e) =>
                      setPollOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))
                    }
                    placeholder={`Option ${i + 1}`}
                  />
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setPollOptions((prev) => prev.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Remove option"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {pollOptions.length < 12 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPollOptions((prev) => [...prev, ""])}>
                  <Plus className="mr-1 h-4 w-4" /> Add option
                </Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={pollMulti} onChange={(e) => setPollMulti(e.target.checked)} />
              Allow multiple answers
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={sending}>Cancel</Button>
          <Button onClick={submit} disabled={sending}>
            {sending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
