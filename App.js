import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
  Modal,
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
// Remplacez par l'URL de votre backend (voir le projet "backend-suivi")
const API_BASE = 'https://mon-enfant-production-be5d.up.railway.app';
const API_URL = `${API_BASE}/api/positions`;
const LOCATION_TASK_NAME = 'background-location-task';
const STORAGE_KEY_CHILD_ID = 'childDeviceId';
const STORAGE_KEY_TRACKING = 'trackingEnabled';
const STORAGE_KEY_PIN = 'parentPin';

// NOTE : le PIN est stocké en clair localement pour simplifier ce prototype.
// Dans une vraie version, validez-le côté serveur (le backend connaît le PIN
// associé au childId) plutôt que de le stocker sur le téléphone de l'enfant,
// sans quoi un enfant technophile pourrait le retrouver dans le stockage de l'app.

// ------------------------------------------------------------------
// TÂCHE DE FOND : appelée par le système même app fermée
// ------------------------------------------------------------------
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Erreur tâche de localisation :', error);
    return;
  }
  if (data) {
    const { locations } = data;
    const childId = await AsyncStorage.getItem(STORAGE_KEY_CHILD_ID);
    if (!childId || !locations || locations.length === 0) return;

    const latest = locations[locations.length - 1];

    try {
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          childId,
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
          accuracy: latest.coords.accuracy,
          timestamp: latest.timestamp,
        }),
      });
    } catch (e) {
      // Pas de réseau : la position sera simplement perdue pour ce tick.
      // Pour une version robuste, on pourrait la mettre en file d'attente locale.
      console.warn('Échec envoi position :', e.message);
    }
  }
});

export default function App() {
  const [childId, setChildId] = useState('');
  const [pin, setPin] = useState('');
  const [savedChildId, setSavedChildId] = useState(null);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState(null);

  // Modale de vérification du PIN parent
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pendingAction, setPendingAction] = useState(null); // 'stop' | 'unpair'

  // Chargement de l'état sauvegardé au démarrage
  useEffect(() => {
    (async () => {
      const id = await AsyncStorage.getItem(STORAGE_KEY_CHILD_ID);
      const tracking = await AsyncStorage.getItem(STORAGE_KEY_TRACKING);
      if (id) setSavedChildId(id);
      if (tracking === 'true') {
        setTrackingEnabled(true);
        await startTracking();
      }
      setLoading(false);
    })();
  }, []);

  const requestPermissions = useCallback(async () => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      Alert.alert(
        'Permission requise',
        "L'accès à la position est nécessaire pour que vos parents puissent vous suivre."
      );
      return false;
    }
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      Alert.alert(
        'Permission "toujours" requise',
        'Pour un suivi même quand l\'application est fermée, choisissez "Toujours autoriser" dans les réglages de localisation du téléphone.'
      );
      return false;
    }
    setPermissionStatus('granted');
    return true;
  }, []);

  const startTracking = async () => {
    const granted = await requestPermissions();
    if (!granted) return;

    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
      LOCATION_TASK_NAME
    );
    if (!alreadyStarted) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 30000, // toutes les 30 secondes
        distanceInterval: 25, // ou tous les 25 mètres
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Suivi de trajet actif',
          notificationBody: 'Ta position est partagée avec tes parents.',
        },
      });
    }
    await AsyncStorage.setItem(STORAGE_KEY_TRACKING, 'true');
    setTrackingEnabled(true);
  };

  const stopTracking = async () => {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
      LOCATION_TASK_NAME
    );
    if (alreadyStarted) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    await AsyncStorage.setItem(STORAGE_KEY_TRACKING, 'false');
    setTrackingEnabled(false);
  };

  const [pairing, setPairing] = useState(false);

  const handlePair = async () => {
    if (!/^\d{4}$/.test(pin)) {
      Alert.alert('Erreur', "Le code PIN parent doit contenir 4 chiffres.");
      return;
    }

    setPairing(true);
    try {
      const res = await fetch(`${API_BASE}/api/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        Alert.alert('Erreur', data.error || "Impossible de créer l'appareil.");
        return;
      }

      await AsyncStorage.setItem(STORAGE_KEY_CHILD_ID, data.childId);
      await AsyncStorage.setItem(STORAGE_KEY_PIN, pin);
      setSavedChildId(data.childId);
    } catch (e) {
      Alert.alert(
        'Erreur',
        'Connexion au serveur impossible. Vérifie ta connexion internet.'
      );
    } finally {
      setPairing(false);
    }
  };

  // Demande le PIN avant d'exécuter une action sensible (couper le suivi, dissocier)
  const requestPinFor = (action) => {
    setPendingAction(action);
    setPinInput('');
    setPinModalVisible(true);
  };

  const confirmPin = async () => {
    const storedPin = await AsyncStorage.getItem(STORAGE_KEY_PIN);
    if (pinInput !== storedPin) {
      Alert.alert('Code incorrect', "Ce code PIN n'est pas correct.");
      return;
    }
    setPinModalVisible(false);
    if (pendingAction === 'stop') {
      await stopTracking();
    } else if (pendingAction === 'unpair') {
      await stopTracking();
      await AsyncStorage.removeItem(STORAGE_KEY_CHILD_ID);
      await AsyncStorage.removeItem(STORAGE_KEY_PIN);
      setSavedChildId(null);
      setChildId('');
      setPin('');
    }
    setPendingAction(null);
  };

  const handleUnpair = () => requestPinFor('unpair');

  const handleToggleTracking = async (value) => {
    if (value) {
      // Activer le suivi ne nécessite pas de PIN : on veut que ce soit facile
      // de le réactiver (ex. après un problème), seul le désactiver est protégé.
      await startTracking();
    } else {
      requestPinFor('stop');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Suivi Enfant</Text>

      {!savedChildId ? (
        <View style={styles.card}>
          <Text style={styles.label}>
            Choisis un code PIN à 4 chiffres. Il servira à tes parents pour
            suivre ton trajet, avec le code d'appareil qui sera généré à
            l'étape suivante.
          </Text>
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={setPin}
            placeholder="Ex : 1234"
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
          />
          <TouchableOpacity
            style={styles.button}
            onPress={handlePair}
            disabled={pairing}
          >
            {pairing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Créer mon appareil</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Ton code d'appareil</Text>
          <Text style={styles.childId}>{savedChildId}</Text>
          <Text style={styles.hint}>
            Donne ce code à tes parents : ils en auront besoin pour suivre
            ton trajet.
          </Text>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Partager ma position</Text>
            <Switch
              value={trackingEnabled}
              onValueChange={handleToggleTracking}
              trackColor={{ true: '#4F46E5' }}
            />
          </View>

          <Text style={styles.hint}>
            {trackingEnabled
              ? 'Ta position est envoyée régulièrement à tes parents, même si tu fermes l\'application.'
              : "Le partage de position est désactivé."}
          </Text>

          <TouchableOpacity style={styles.linkButton} onPress={handleUnpair}>
            <Text style={styles.linkButtonText}>Dissocier cet appareil</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Code PIN parent requis</Text>
            <Text style={styles.hint}>
              Demande à ton parent de saisir son code pour continuer.
            </Text>
            <TextInput
              style={styles.input}
              value={pinInput}
              onChangeText={setPinInput}
              placeholder="Code PIN"
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setPinModalVisible(false)}
              >
                <Text style={styles.linkButtonText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={confirmPin}>
                <Text style={styles.buttonText}>Valider</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingTop: 80,
    paddingHorizontal: 24,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 32,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  label: {
    fontSize: 15,
    color: '#374151',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  childId: {
    fontSize: 20,
    fontWeight: '700',
    color: '#4F46E5',
    marginBottom: 20,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchLabel: {
    fontSize: 16,
    color: '#111827',
  },
  hint: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 12,
    lineHeight: 18,
  },
  linkButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkButtonText: {
    color: '#EF4444',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 8,
    gap: 16,
  },
  modalCancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
});
