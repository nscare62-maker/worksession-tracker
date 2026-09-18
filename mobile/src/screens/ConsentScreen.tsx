import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { api } from "../services/api";

const CONSENT_TEXT = `Work-Session Location Tracking — What You're Agreeing To

- Your location is shared with your manager ONLY while you are clocked in
  (from the moment you tap "Punch In" until you tap "Punch Out").
- You are never tracked while clocked out. There is no background tracking
  outside of an active work session.
- Location updates roughly every 60 seconds, or when you move more than
  100 meters, whichever comes first.
- Your manager can see your live position and, for completed shifts, the
  route you traveled during that shift.
- Location data is not used to make automatic disciplinary decisions.
- You can decline location permission and still clock in using the
  no-location attendance option — ask your manager how that's handled at
  your workplace.
- You can withdraw consent at any time by contacting your manager; doing so
  may require using the no-location attendance option going forward.`;

// A simple, deterministic hash so the server can record exactly which text
// version was shown (swap for a real SHA-256 in production).
function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return `v1-${Math.abs(hash)}`;
}

export function ConsentScreen({ onAcknowledged }: { onAcknowledged: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAgree() {
    setSubmitting(true);
    setError(null);
    try {
      await api.acknowledgeConsent(simpleHash(CONSENT_TEXT));
      onAcknowledged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record consent");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Before you punch in</Text>
      <ScrollView style={styles.scroll}>
        <Text style={styles.body}>{CONSENT_TEXT}</Text>
      </ScrollView>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={handleAgree} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? "Recording..." : "I Understand & Agree"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#0f172a" },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 16 },
  scroll: { flex: 1, marginBottom: 16 },
  body: { color: "#cbd5e1", lineHeight: 22, fontSize: 14 },
  button: { backgroundColor: "#2563eb", padding: 16, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  error: { color: "#f87171", marginBottom: 12 },
});
