import React, { useEffect, useState } from "react";
import { SafeAreaView, ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ConsentScreen } from "./src/screens/ConsentScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { api } from "./src/services/api";

function Gate() {
  const { user } = useAuth();
  const [checkingConsent, setCheckingConsent] = useState(true);
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    if (!user) return;
    setCheckingConsent(true);
    api
      .getConsentStatus()
      .then((res) => setHasConsent(res.hasAcknowledgedCurrent))
      .finally(() => setCheckingConsent(false));
  }, [user]);

  if (!user) return <LoginScreen />;

  if (checkingConsent) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!hasConsent) {
    return <ConsentScreen onAcknowledged={() => setHasConsent(true)} />;
  }

  return <HomeScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }}>
        <Gate />
      </SafeAreaView>
    </AuthProvider>
  );
}
