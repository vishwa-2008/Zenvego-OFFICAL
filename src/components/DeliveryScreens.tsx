import React, { useState } from 'react';
import { DeliveryAssignmentDoc, DeliveryProfileDoc, ScreenId } from '../types';
import { LiveTrackingMap, type PartnerGpsTelemetry } from './MapLibreWidgets';
import { useLiveLocation } from '../hooks/useLiveLocation';
import { LiveCameraCapture } from './LiveCameraVerify';
import { QrGeneratorModal, QrScannerModal } from './QrWidgets';

// 1. Partner Full KYC, Live Camera Photo Verification & Vehicle Setup (Firestore delivery_profiles/{uid})
interface PartnerOnboardingProps {
  profile: DeliveryProfileDoc | null;
  defaultName: string;
  onSaveProfile: (profile: Omit<DeliveryProfileDoc, 'userId'>) => Promise<void>;
  onComplete: () => void;
  onNotify: (msg: string) => void;
}

export const PartnerOnboardingScreen: React.FC<PartnerOnboardingProps> = ({
  profile,
  defaultName,
  onSaveProfile,
  onComplete,
  onNotify,
}) => {
  const [partnerName, setPartnerName] = useState(profile?.partnerName || defaultName || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [emergencyPhone, setEmergencyPhone] = useState(profile?.emergencyPhone || '');
  const [vehicleType, setVehicleType] = useState<'ev' | 'petrol' | 'bicycle'>(profile?.vehicleType || 'ev');
  const [vehiclePlate, setVehiclePlate] = useState(profile?.vehiclePlate || '');
  const [dlNumber, setDlNumber] = useState(profile?.dlNumber || '');
  const [govIdType, setGovIdType] = useState<'aadhaar' | 'dl' | 'pan'>(
    profile?.govIdType || 'dl'
  );
  const [govIdLast4, setGovIdLast4] = useState(profile?.govIdLast4 || '');
  const [liveSelfieData, setLiveSelfieData] = useState(profile?.liveSelfieData || '');
  const [idDocumentPhotoData, setIdDocumentPhotoData] = useState(profile?.idDocumentPhotoData || '');
  const [livePhotoCapturedAt, setLivePhotoCapturedAt] = useState(profile?.livePhotoCapturedAt || '');
  const [livenessConfirmed, setLivenessConfirmed] = useState(Boolean(profile?.livenessConfirmed));
  const [clusterArea, setClusterArea] = useState(profile?.clusterArea || 'Indiranagar & Domlur Hub');
  const [saving, setSaving] = useState(false);

  const needsMotorDocs = vehicleType !== 'bicycle';
  const checklist = [
    { label: 'Full Name & Mobile Phone', ok: partnerName.trim().length >= 2 && phone.trim().length >= 8 },
    { label: 'Government ID (Last 4)', ok: govIdLast4.trim().length >= 4 },
    {
      label: needsMotorDocs ? 'Vehicle Plate & DL Ref' : 'Bicycle Cluster Ready',
      ok: needsMotorDocs ? vehiclePlate.trim().length >= 4 && dlNumber.trim().length >= 4 : true,
    },
    { label: 'Live Person Selfie Captured', ok: liveSelfieData.startsWith('data:image/') },
    { label: 'Live ID / Vehicle Proof Photo', ok: idDocumentPhotoData.startsWith('data:image/') },
    { label: 'Liveness & Safety Pledge', ok: livenessConfirmed },
  ];
  const allVerified = checklist.every((c) => c.ok);
  const completedChecks = checklist.filter((c) => c.ok).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerName.trim()) {
      onNotify('Please enter your full legal name.');
      return;
    }
    if (phone.trim().length < 8) {
      onNotify('Please enter a valid active mobile number.');
      return;
    }
    if (govIdLast4.trim().length < 4) {
      onNotify('Enter the last 4 characters of your Government ID.');
      return;
    }
    if (needsMotorDocs && (!vehiclePlate.trim() || !dlNumber.trim())) {
      onNotify('Vehicle registration plate and Driving License reference are required for EV/Two-Wheeler partners.');
      return;
    }
    if (!liveSelfieData.startsWith('data:image/')) {
      onNotify('Real-time live person selfie via camera is required for Delivery Partner KYC.');
      return;
    }
    if (!idDocumentPhotoData.startsWith('data:image/')) {
      onNotify('Real-time live photo of your Vehicle / Driving License / ID is required.');
      return;
    }
    if (!livenessConfirmed) {
      onNotify('Please confirm the live identity & road safety declaration.');
      return;
    }

    setSaving(true);
    try {
      await onSaveProfile({
        partnerName: partnerName.trim(),
        phone: phone.trim(),
        emergencyPhone: emergencyPhone.trim() || undefined,
        vehicleType,
        vehiclePlate: vehiclePlate.trim().toUpperCase() || undefined,
        dlNumber: dlNumber.trim().toUpperCase() || undefined,
        govIdType,
        govIdLast4: govIdLast4.trim().toUpperCase().slice(-4),
        liveSelfieData,
        idDocumentPhotoData,
        livePhotoCapturedAt: livePhotoCapturedAt || new Date().toISOString(),
        livenessConfirmed: true,
        clusterArea: clusterArea.trim() || 'Indiranagar Hub',
        availableForDispatch: true,
        kycStatus: 'verified',
      });
      onComplete();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save partner verification profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col w-full gap-5 pb-10 max-w-2xl mx-auto">
      {/* Eco-Partner Verification Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-container to-secondary p-5 text-on-primary shadow-md">
        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full text-white font-semibold inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">verified_user</span>
              Full Delivery Partner KYC &amp; Live Photo Verification
            </span>
            <span className="text-[11px] bg-secondary-container text-on-secondary-container px-2.5 py-0.5 rounded-full font-extrabold tabular-nums">
              {completedChecks}/{checklist.length} Verified
            </span>
          </div>
          <h2 className="text-base font-extrabold text-white leading-snug">
            Verify Your Live Identity, Government ID &amp; Vehicle for Hyperlocal Dispatch
          </h2>
          <p className="text-xs text-white/90">
            Every Zenvego Delivery Partner completes live camera selfie verification and vehicle/ID proof before accepting farm pickups and doorstep QR handshakes.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
            {checklist.map((item) => (
              <div
                key={item.label}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 ${
                  item.ok ? 'bg-emerald-500/25 text-emerald-100' : 'bg-white/10 text-white/80'
                }`}
              >
                <span className="material-symbols-outlined text-[15px] shrink-0">
                  {item.ok ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                <span className="truncate">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Step 1: Identity, Contact & Vehicle Details */}
      <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm space-y-4 border border-outline-variant/20">
        <div>
          <h3 className="text-sm font-extrabold text-primary">1. Partner Identity, Contact &amp; Government ID</h3>
          <p className="text-xs text-on-surface-variant">
            Only the last 4 characters of your Government ID are persisted for security &amp; privacy.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-on-surface mb-1">Full Legal Partner Name *</label>
            <input
              type="text"
              required
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
              placeholder="e.g., Ravi Kumar (as on Driving License / Aadhaar)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Active Mobile Number *</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Emergency Contact Phone</label>
            <input
              type="tel"
              value={emergencyPhone}
              onChange={(e) => setEmergencyPhone(e.target.value)}
              placeholder="+91 98765 00000"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Government ID Type *</label>
            <select
              value={govIdType}
              onChange={(e) =>
                setGovIdType(e.target.value as 'aadhaar' | 'dl' | 'pan')
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary"
            >
              <option value="dl">Driving License</option>
              <option value="aadhaar">Aadhaar Card</option>
              <option value="pan">PAN Card</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Gov ID Last 4 Characters *</label>
            <input
              type="text"
              required
              maxLength={4}
              value={govIdLast4}
              onChange={(e) => setGovIdLast4(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4))}
              placeholder="e.g., 9221"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low text-sm font-mono uppercase tracking-widest text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-on-surface mb-2">Vehicle Category</label>
          <div className="grid grid-cols-3 gap-2 bg-surface-container-low p-1.5 rounded-xl">
            {(
              [
                { id: 'ev', icon: 'electric_moped', label: 'EV Scooter', sub: 'Zero Emission' },
                { id: 'petrol', icon: 'sports_motorsports', label: 'Two-Wheeler', sub: 'Standard' },
                { id: 'bicycle', icon: 'pedal_bike', label: 'Bicycle', sub: '<3 km drops' },
              ] as const
            ).map((v) => {
              const active = vehicleType === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVehicleType(v.id)}
                  className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all cursor-pointer ${
                    active
                      ? 'bg-primary-container text-on-primary shadow-sm'
                      : 'bg-transparent text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  <span className="material-symbols-outlined text-[22px] mb-1">{v.icon}</span>
                  <span className="text-[11px] font-bold">{v.label}</span>
                  <span className={`text-[10px] mt-0.5 font-bold ${active ? 'text-secondary-container' : 'text-outline'}`}>
                    {v.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">
              Vehicle Registration Plate {needsMotorDocs ? '*' : '(Optional)'}
            </label>
            <input
              type="text"
              required={needsMotorDocs}
              value={vehiclePlate}
              onChange={(e) => setVehiclePlate(e.target.value)}
              placeholder="e.g., KA 03 EV 4120"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low text-sm font-mono uppercase text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">
              Driving License Reference {needsMotorDocs ? '*' : '(Optional)'}
            </label>
            <input
              type="text"
              required={needsMotorDocs}
              value={dlNumber}
              onChange={(e) => setDlNumber(e.target.value)}
              placeholder="e.g., KA03-20220089221"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low text-sm font-mono uppercase text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-on-surface mb-1">Active Delivery Cluster</label>
          <select
            value={clusterArea}
            onChange={(e) => setClusterArea(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary"
          >
            <option value="Indiranagar & Domlur Hub">Indiranagar &amp; Domlur Hub</option>
            <option value="Koramangala & HSR Hub">Koramangala &amp; HSR Hub</option>
            <option value="Whitefield Terrace Cluster">Whitefield Terrace Cluster</option>
            <option value="Jayanagar & JP Nagar Hub">Jayanagar &amp; JP Nagar Hub</option>
            <option value="Malleswaram & Hebbal Hub">Malleswaram &amp; Hebbal Hub</option>
          </select>
        </div>
      </div>

      {/* Step 2: Mandatory Live Camera Photo Verification */}
      <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm space-y-4 border border-outline-variant/20">
        <div>
          <h3 className="text-sm font-extrabold text-primary">2. Real-Time Live Camera Photo Verification</h3>
          <p className="text-xs text-on-surface-variant">
            Live device camera capture only (gallery uploads disabled). Photos are embedded with a live verification timestamp for buyer &amp; grower safety.
          </p>
        </div>

        <LiveCameraCapture
          title="Live Person Selfie Verification"
          subtitle="Center your face inside the oval guide in bright light without sunglasses or masks."
          mode="selfie"
          value={liveSelfieData}
          capturedAt={livePhotoCapturedAt}
          required
          onCapture={(dataUrl, iso) => {
            setLiveSelfieData(dataUrl);
            setLivePhotoCapturedAt(iso);
            onNotify('Live partner selfie captured & stamped');
          }}
          onClear={() => setLiveSelfieData('')}
        />

        <LiveCameraCapture
          title="Live Vehicle / License / ID Proof Photo"
          subtitle="Capture a live rear-camera photo of your EV/vehicle plate or Driving License."
          mode="document"
          value={idDocumentPhotoData}
          capturedAt={livePhotoCapturedAt}
          required
          onCapture={(dataUrl, iso) => {
            setIdDocumentPhotoData(dataUrl);
            if (!livePhotoCapturedAt) setLivePhotoCapturedAt(iso);
            onNotify('Live vehicle/ID proof photo captured');
          }}
          onClear={() => setIdDocumentPhotoData('')}
        />

        <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/25 text-xs text-on-surface cursor-pointer">
          <input
            type="checkbox"
            checked={livenessConfirmed}
            onChange={(e) => setLivenessConfirmed(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span>
            <strong>Live Liveness &amp; Safety Declaration:</strong> I confirm that this live selfie and vehicle/ID proof were captured in real time by me, belong to my {govIdType === 'dl' ? 'Driving License' : govIdType === 'aadhaar' ? 'Aadhaar' : 'PAN'} (ending in {govIdLast4 || '____'}), and I agree to follow Zenvego&apos;s fresh produce hygiene and QR handover rules.
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={saving || !allVerified}
        className="w-full h-12 rounded-xl bg-primary-container hover:bg-primary text-on-primary text-sm font-bold flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[20px]">verified_user</span>
        <span>
          {saving
            ? 'Verifying & Saving Partner KYC...'
            : allVerified
              ? 'Complete Full Partner KYC & Activate Dispatch'
              : `Complete All ${checklist.length} Verification Steps (${completedChecks}/${checklist.length})`}
        </span>
      </button>
    </form>
  );
};

// 2. Delivery Partner Status, Duty Shift & Field ID
interface PartnerAuditProps {
  profile: DeliveryProfileDoc | null;
  activeAssignmentsCount: number;
  completedCount: number;
  onToggleShift: () => Promise<void>;
  onNavigate: (screen: ScreenId) => void;
}

export const PartnerAuditScreen: React.FC<PartnerAuditProps> = ({
  profile,
  activeAssignmentsCount,
  completedCount,
  onToggleShift,
  onNavigate,
}) => {
  const [badgeOpen, setBadgeOpen] = useState(false);

  if (!profile) {
    return (
      <div className="max-w-lg mx-auto bg-surface-container-lowest rounded-2xl p-6 text-center space-y-4 shadow-sm">
        <span className="material-symbols-outlined text-4xl text-primary">badge</span>
        <h2 className="text-lg font-extrabold text-primary">Complete Partner KYC &amp; Live Photo Verification First</h2>
        <p className="text-xs text-on-surface-variant">
          Complete your live camera selfie and vehicle/ID verification before activating a duty shift or claiming live pickups.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('delivery-onboarding')}
          className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
        >
          Start Live Verification
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-4 pb-10 max-w-2xl mx-auto">
      <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col gap-3 border border-outline-variant/20">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-2.5 py-1 rounded-full bg-surface-container-high text-primary text-[11px] font-bold">
              VERIFIED FIELD PARTNER ID
            </span>
            {profile.liveSelfieData && (
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 text-[11px] font-extrabold inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">photo_camera</span>
                Live Photo Verified
              </span>
            )}
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
              profile.availableForDispatch
                ? 'bg-secondary-container text-on-secondary-container'
                : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {profile.availableForDispatch ? 'On Duty' : 'Off Duty'}
          </span>
        </div>

        <div className="flex items-center gap-3.5">
          {profile.liveSelfieData ? (
            <img
              src={profile.liveSelfieData}
              alt={profile.partnerName}
              className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-600/30 shadow-xs shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-primary text-on-primary flex items-center justify-center font-extrabold text-xl shrink-0">
              {profile.partnerName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold text-on-surface truncate">{profile.partnerName}</h2>
            <p className="text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
              <span className="material-symbols-outlined text-[15px] text-secondary">location_on</span>
              <span>{profile.clusterArea}</span>
            </p>
            <p className="text-xs text-on-surface-variant font-mono mt-0.5">
              Vehicle: {profile.vehicleType.toUpperCase()} {profile.vehiclePlate ? `· ${profile.vehiclePlate}` : ''}
              {profile.govIdType && profile.govIdLast4
                ? ` · ${profile.govIdType === 'dl' ? 'DL' : profile.govIdType === 'aadhaar' ? 'Aadhaar' : 'PAN'} ••••${profile.govIdLast4}`
                : ''}
            </p>
            {profile.livePhotoCapturedAt && (
              <p className="text-[11px] text-emerald-800 font-semibold mt-0.5">
                Live KYC Verified: {new Date(profile.livePhotoCapturedAt).toLocaleString('en-IN')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Real Firestore-Derived Metrics */}
      <div className="grid grid-cols-3 gap-2.5 tabular-nums">
        <div className="bg-surface-container-lowest p-3.5 rounded-xl shadow-sm">
          <span className="text-xs text-on-surface-variant block">Active Runs</span>
          <span className="text-lg font-extrabold text-primary block mt-0.5">{activeAssignmentsCount}</span>
        </div>
        <div className="bg-surface-container-lowest p-3.5 rounded-xl shadow-sm">
          <span className="text-xs text-on-surface-variant block">Delivered</span>
          <span className="text-lg font-extrabold text-secondary block mt-0.5">{completedCount}</span>
        </div>
        <div className="bg-surface-container-lowest p-3.5 rounded-xl shadow-sm">
          <span className="text-xs text-on-surface-variant block">KYC Status</span>
          <span className="text-sm font-extrabold text-primary block mt-1 capitalize">{profile.kycStatus}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onToggleShift}
          className={`w-full h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer ${
            profile.availableForDispatch
              ? 'bg-secondary text-on-secondary'
              : 'bg-primary-container hover:bg-primary text-on-primary'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {profile.availableForDispatch ? 'pause_circle' : 'bolt'}
          </span>
          <span>{profile.availableForDispatch ? 'Pause Duty Shift' : 'Activate Duty Shift'}</span>
        </button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setBadgeOpen(true)}
            className="h-12 bg-surface-container-lowest hover:bg-surface-container-high text-primary rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
            <span>Partner Storefront QR</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('delivery-pickup')}
            className="h-12 bg-secondary-container text-on-secondary-container rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">local_shipping</span>
            <span>Open Live Dispatch Queue</span>
          </button>
        </div>
      </div>

      <QrGeneratorModal
        open={badgeOpen}
        title="Verified Field Partner QR"
        subtitle={`${profile.partnerName} · ${profile.clusterArea}`}
        requestPayload={{
          type: 'store',
          growerId: profile.userId,
          farmName: `${profile.partnerName} (EV Partner)`,
          areaName: profile.clusterArea,
        }}
        onClose={() => setBadgeOpen(false)}
      />
    </div>
  );
};

// 3. Live Delivery Dispatch, Route Navigation & Server-Verified QR Handshake
interface PickupHandshakeProps {
  currentUid: string | null;
  partnerProfile: DeliveryProfileDoc | null;
  assignments: DeliveryAssignmentDoc[];
  onAcceptAssignment: (assignment: DeliveryAssignmentDoc) => Promise<void>;
  onPickupVerified: (assignment: DeliveryAssignmentDoc, verifiedAtIso: string) => Promise<void>;
  onDeliveryVerified: (assignment: DeliveryAssignmentDoc, deliveredAtIso: string) => Promise<void>;
  onReportIssue: (assignment: DeliveryAssignmentDoc, note: string) => Promise<void>;
  onBroadcastPartnerLocation?: (assignmentId: string, lat: number, lng: number) => void;
  onBroadcastPartnerTelemetry?: (assignment: DeliveryAssignmentDoc, telemetry: PartnerGpsTelemetry) => void;
  onPartnerMarkMilestone?: (assignment: DeliveryAssignmentDoc, stage: 'NEAR_DESTINATION' | 'ARRIVED') => Promise<void>;
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string) => void;
}

export const PickupHandshakeScreen: React.FC<PickupHandshakeProps> = ({
  currentUid,
  partnerProfile,
  assignments,
  onAcceptAssignment,
  onPickupVerified,
  onDeliveryVerified,
  onReportIssue,
  onBroadcastPartnerLocation,
  onBroadcastPartnerTelemetry,
  onPartnerMarkMilestone,
  onNavigate,
  onNotify,
}) => {
  const [scannerTarget, setScannerTarget] = useState<{
    assignment: DeliveryAssignmentDoc;
    action: 'pickup' | 'delivery';
  } | null>(null);
  const [issueTarget, setIssueTarget] = useState<DeliveryAssignmentDoc | null>(null);
  const [issueNote, setIssueNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { permissionStatus, error: gpsPermissionError } = useLiveLocation({ autoStart: false });

  if (!partnerProfile) {
    return (
      <div className="max-w-lg mx-auto bg-surface-container-lowest rounded-2xl p-6 text-center space-y-4 shadow-sm">
        <span className="material-symbols-outlined text-4xl text-primary">two_wheeler</span>
        <h2 className="text-lg font-extrabold text-primary">Activate Partner Profile to Receive Dispatches</h2>
        <p className="text-xs text-on-surface-variant">
          Complete your EV/vehicle profile first so Firestore Security Rules authorize your account to accept pickup assignments.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('delivery-onboarding')}
          className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
        >
          Complete Onboarding
        </button>
      </div>
    );
  }

  const openAssignments = assignments.filter((a) => a.status === 'open');
  const myActive = assignments.filter(
    (a) => a.partnerId === currentUid && (a.status === 'accepted' || a.status === 'picked_up')
  );
  const myHistory = assignments.filter(
    (a) => a.partnerId === currentUid && (a.status === 'delivered' || a.status === 'issue_reported')
  );

  const handleAccept = async (assignment: DeliveryAssignmentDoc) => {
    setBusyId(assignment.id);
    try {
      await onAcceptAssignment(assignment);
    } finally {
      setBusyId(null);
    }
  };

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueTarget || !issueNote.trim()) return;
    setBusyId(issueTarget.id);
    try {
      await onReportIssue(issueTarget, issueNote.trim());
      setIssueTarget(null);
      setIssueNote('');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col w-full gap-5 pb-10 max-w-3xl mx-auto">
      {permissionStatus === 'denied' && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs font-medium">
          <span className="material-symbols-outlined text-[18px] text-red-700 shrink-0 mt-0.5">location_disabled</span>
          <span>
            {gpsPermissionError ||
              'Browser location permission is blocked. Allow Location access in your browser site settings so live delivery tracking works.'}
          </span>
        </div>
      )}

      {/* Section 1: Partner's Active Deliveries */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-primary">My Active Deliveries ({myActive.length})</h2>
          <span className="text-xs font-semibold text-on-surface-variant">{partnerProfile.clusterArea}</span>
        </div>

        {myActive.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl p-5 text-center text-xs text-on-surface-variant border border-outline-variant/20">
            No active delivery right now. Claim an open ready-for-pickup assignment below.
          </div>
        ) : (
          myActive.map((a) => (
            <div
              key={a.id}
              className="bg-surface-container-lowest rounded-2xl p-4 sm:p-5 shadow-sm border border-outline-variant/25 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-extrabold text-primary">{a.orderCode}</span>
                  <h3 className="text-base font-bold text-on-surface">
                    {a.farmName} → Customer Drop
                  </h3>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase ${
                    a.status === 'picked_up'
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {a.status === 'picked_up' ? 'Out for Delivery' : 'En Route to Pickup'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="bg-surface-container-low rounded-xl p-3">
                  <span className="font-bold text-primary block">Pickup (Grower)</span>
                  <span className="text-on-surface-variant">{a.pickupAddress}</span>
                </div>
                <div className="bg-surface-container-low rounded-xl p-3">
                  <span className="font-bold text-amber-900 block">Dropoff (Customer)</span>
                  <span className="text-on-surface-variant">{a.dropoffAddress}</span>
                </div>
              </div>

              {/* Real-Time OpenFreeMap + Socket.IO + OSRM Live EV GPS Broadcast */}
              <LiveTrackingMap
                orderId={a.parentOrderId}
                assignmentId={a.id}
                socketRole="partner"
                pickup={{ lat: a.pickupLat, lng: a.pickupLng }}
                dropoff={{ lat: a.dropoffLat, lng: a.dropoffLng }}
                farmName={a.farmName}
                dropoffLabel={a.dropoffAddress}
                stage={a.status}
                allowLiveLocationShare={true}
                livePartnerPos={
                  typeof a.partnerLat === 'number' && typeof a.partnerLng === 'number'
                    ? { lat: a.partnerLat, lng: a.partnerLng }
                    : null
                }
                lastLocationAt={a.lastLocationAt}
                partnerName={partnerProfile.partnerName}
                onPartnerCoordsUpdate={(lat, lng) => onBroadcastPartnerLocation?.(a.id, lat, lng)}
                onPartnerTelemetryUpdate={(telemetry) => onBroadcastPartnerTelemetry?.(a, telemetry)}
                onMarkMilestone={(stage) => {
                  void onPartnerMarkMilestone?.(a, stage);
                }}
                heightClass="h-80 sm:h-96"
              />

              {/* Server-Verified QR Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                {a.status === 'accepted' && (
                  <button
                    type="button"
                    onClick={() => setScannerTarget({ assignment: a, action: 'pickup' })}
                    className="flex-1 min-w-[200px] h-12 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]">qr_code_scanner</span>
                    <span>Verify Pickup QR / Handover PIN</span>
                  </button>
                )}

                {a.status === 'picked_up' && (
                  <button
                    type="button"
                    onClick={() => setScannerTarget({ assignment: a, action: 'delivery' })}
                    className="flex-1 min-w-[200px] h-12 rounded-xl bg-secondary hover:bg-primary text-on-secondary text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]">task_alt</span>
                    <span>Verify Delivery QR / Complete Drop</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIssueTarget(a)}
                  className="h-12 px-4 rounded-xl bg-red-50 text-red-800 border border-red-200 text-xs font-bold cursor-pointer"
                >
                  Report Issue
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Section 2: Open Ready-for-Pickup Queue */}
      <section className="space-y-3">
        <h2 className="text-base font-extrabold text-primary">
          Open Pickups Available ({openAssignments.length})
        </h2>

        {openAssignments.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl p-6 text-center space-y-1.5 border border-outline-variant/20">
            <span className="material-symbols-outlined text-3xl text-outline">local_shipping</span>
            <p className="text-sm font-bold text-on-surface">No open pickups in queue</p>
            <p className="text-xs text-on-surface-variant">
              When a grower marks a customer order Ready for Pickup, it appears here immediately via Firestore real-time sync.
            </p>
          </div>
        ) : (
          openAssignments.map((a) => (
            <div
              key={a.id}
              className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-outline-variant/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold text-primary">{a.orderCode}</span>
                  <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold">
                    READY FOR PICKUP
                  </span>
                </div>
                <p className="text-sm font-bold text-on-surface truncate">Pickup: {a.farmName}</p>
                <p className="text-xs text-on-surface-variant truncate">Dropoff: {a.dropoffAddress}</p>
              </div>
              <button
                type="button"
                disabled={busyId === a.id}
                onClick={() => handleAccept(a)}
                className="px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold shrink-0 cursor-pointer disabled:opacity-60"
              >
                {busyId === a.id ? 'Accepting...' : 'Accept Assignment'}
              </button>
            </div>
          ))
        )}
      </section>

      {/* Section 3: Completed / History */}
      {myHistory.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-sm font-extrabold text-on-surface-variant uppercase tracking-wider">
            Delivery History ({myHistory.length})
          </h2>
          {myHistory.map((a) => (
            <div
              key={a.id}
              className="bg-surface-container-low rounded-xl p-3.5 flex items-center justify-between gap-2 text-xs"
            >
              <div className="min-w-0">
                <span className="font-bold text-on-surface">
                  {a.orderCode} · {a.farmName}
                </span>
                <p className="text-on-surface-variant truncate">{a.dropoffAddress}</p>
                {a.issueNote && <p className="text-red-700 font-medium mt-0.5">Issue: {a.issueNote}</p>}
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] shrink-0 ${
                  a.status === 'delivered'
                    ? 'bg-emerald-100 text-emerald-900'
                    : 'bg-red-100 text-red-900'
                }`}
              >
                {a.status === 'delivered' ? 'Delivered' : 'Exception'}
              </span>
            </div>
          ))}
        </section>
      )}

      {/* Real Camera QR Scanner + Server Consumption Modal */}
      <QrScannerModal
        open={Boolean(scannerTarget)}
        title={
          scannerTarget?.action === 'pickup'
            ? `Verify Pickup — ${scannerTarget.assignment.orderCode}`
            : `Verify Delivery — ${scannerTarget?.assignment.orderCode || ''}`
        }
        expectedAction={scannerTarget?.action || 'pickup'}
        expectedOrderId={scannerTarget?.assignment.parentOrderId || ''}
        onVerified={async (res) => {
          if (!scannerTarget) return;
          const target = scannerTarget;
          setScannerTarget(null);
          try {
            if (target.action === 'pickup') {
              await onPickupVerified(target.assignment, res.verifiedAt);
            } else {
              await onDeliveryVerified(target.assignment, res.verifiedAt);
            }
          } catch (err) {
            onNotify(err instanceof Error ? err.message : 'Failed to record verification in Firestore');
          }
        }}
        onClose={() => setScannerTarget(null)}
      />

      {/* Delivery Exception Modal */}
      {issueTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleIssueSubmit}
            className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl space-y-3"
          >
            <h3 className="font-headline font-bold text-base text-primary">
              Report Delivery Issue ({issueTarget.orderCode})
            </h3>
            <p className="text-xs text-on-surface-variant">
              Select or describe why delivery could not be completed. The order will NOT be marked delivered.
            </p>
            <textarea
              required
              rows={3}
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
              placeholder="e.g., Customer unreachable at gate after 2 attempts"
              className="w-full p-3 rounded-xl border border-outline-variant text-xs focus:outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIssueTarget(null)}
                className="px-4 py-2 rounded-xl bg-surface-container text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-red-700 text-white text-xs font-bold cursor-pointer"
              >
                Log Exception
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
