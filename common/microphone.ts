export const SYSTEM_DEFAULT_MICROPHONE_ID = "default";

export interface MicrophoneDevice {
  id: string;
  label: string;
  groupId: string;
}

export interface MicrophonePreference {
  id: string;
  label: string;
  groupId: string;
}

export const SYSTEM_DEFAULT_MICROPHONE: MicrophoneDevice = {
  id: SYSTEM_DEFAULT_MICROPHONE_ID,
  label: "System default",
  groupId: "",
};

export interface ResolvedMicrophonePreference {
  device: MicrophoneDevice;
  preference: MicrophonePreference;
  unavailable: boolean;
  changed: boolean;
}

/**
 * Resolve a persisted preference against the current device catalog. Chromium
 * device ids can change after a replug, so fall back to group id and then a
 * unique label before using the system default.
 */
export function resolveMicrophonePreference(
  preference: MicrophonePreference,
  devices: readonly MicrophoneDevice[],
): ResolvedMicrophonePreference {
  if (preference.id === SYSTEM_DEFAULT_MICROPHONE_ID) {
    return {
      device: SYSTEM_DEFAULT_MICROPHONE,
      preference: microphonePreference(SYSTEM_DEFAULT_MICROPHONE),
      unavailable: false,
      changed: !samePreference(preference, SYSTEM_DEFAULT_MICROPHONE),
    };
  }

  const physicalDevices = devices.filter(
    (device) => device.id !== SYSTEM_DEFAULT_MICROPHONE_ID,
  );
  const exact = physicalDevices.find((device) => device.id === preference.id);
  const groupMatch =
    exact ??
    (preference.groupId
      ? uniqueMatch(physicalDevices.filter((device) => device.groupId === preference.groupId))
      : null);
  const labelMatch =
    groupMatch ??
    (preference.label
      ? uniqueMatch(physicalDevices.filter((device) => device.label === preference.label))
      : null);

  if (labelMatch) {
    return {
      device: labelMatch,
      preference: microphonePreference(labelMatch),
      unavailable: false,
      changed: !samePreference(preference, labelMatch),
    };
  }

  return {
    device: SYSTEM_DEFAULT_MICROPHONE,
    preference,
    unavailable: true,
    changed: false,
  };
}

export function microphonePreference(device: MicrophoneDevice): MicrophonePreference {
  return { id: device.id, label: device.label, groupId: device.groupId };
}

function uniqueMatch(devices: readonly MicrophoneDevice[]): MicrophoneDevice | null {
  return devices.length === 1 ? devices[0] : null;
}

function samePreference(
  preference: MicrophonePreference,
  device: MicrophoneDevice,
): boolean {
  return (
    preference.id === device.id &&
    preference.label === device.label &&
    preference.groupId === device.groupId
  );
}
