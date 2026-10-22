// Aba "Perfil" — cartão de visita editável, no estilo Instagram/WhatsApp:
// banner largo (imagem arrastável ou gradiente pronto), foto grande sobreposta,
// apelido e recado. Tudo fica em rascunho até "Salvar"; tocar na foto abre a
// visualização em tela cheia com as opções de troca.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  Check,
  Eye,
  ImageIcon,
  ImagePlus,
  Loader2,
  Move,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { PROFILE_LABEL, presetOf } from "@/lib/team/permissions";
import { cn } from "@/lib/utils";
import {
  BANNER_PRESETS,
  BIO_MAX,
  DEFAULT_BANNER,
  bannerCss,
  initialsOf,
  prepareImage,
  removeProfileImage,
  updateProfile,
  uploadProfileImage,
  type ProfilePatch,
} from "@/lib/profile-media";
import { SettingsTabHeader } from "./settings-ui";
import "./profile.css";

const NAME_MAX = 40;

/** Imagem escolhida e ainda não enviada. */
interface PendingImage {
  file: File;
  preview: string;
}

type Sheet = null | "avatar" | "banner";

/** `asPage`: dentro da rota /perfil, que já tem o próprio cabeçalho. */
export function ProfileTab({ asPage = false }: { asPage?: boolean } = {}) {
  const { user, profile, company, refreshProfile } = useAuth();
  const team = useTeamAccess();

  const savedName = profile?.display_name ?? user?.email?.split("@")[0] ?? "";
  const savedBio = profile?.bio ?? "";
  const savedPreset = profile?.banner_preset ?? DEFAULT_BANNER.id;

  const [name, setName] = useState(savedName);
  const [bio, setBio] = useState(savedBio);
  const [preset, setPreset] = useState(savedPreset);
  // undefined = sem mudança; null = remover; objeto = nova imagem.
  const [avatar, setAvatar] = useState<PendingImage | null | undefined>(undefined);
  const [banner, setBanner] = useState<PendingImage | null | undefined>(undefined);
  const [bannerFocus, setBannerFocus] = useState(0.5);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [viewer, setViewer] = useState(false);
  const [saving, setSaving] = useState(false);

  // Recarrega o rascunho quando o perfil salvo muda (ex.: após salvar).
  useEffect(() => {
    setName(savedName);
    setBio(savedBio);
    setPreset(savedPreset);
  }, [savedName, savedBio, savedPreset]);

  // Libera as prévias locais.
  useEffect(() => {
    return () => {
      if (avatar) URL.revokeObjectURL(avatar.preview);
    };
  }, [avatar]);
  useEffect(() => {
    return () => {
      if (banner) URL.revokeObjectURL(banner.preview);
    };
  }, [banner]);

  /** Volta o banner para gradiente: apaga a imagem salva ou só descarta a nova. */
  const dropBannerImage = () => setBanner(profile?.banner_url ? null : undefined);

  const avatarSrc = avatar === undefined ? profile?.avatar_url : avatar?.preview;
  const bannerSrc = banner === undefined ? profile?.banner_url : banner?.preview;
  const shownName = name.trim() || savedName || "Seu nome";

  const dirty =
    name.trim() !== savedName ||
    bio.trim() !== savedBio ||
    preset !== savedPreset ||
    avatar !== undefined ||
    banner !== undefined;

  const roleLabel = team.access?.role
    ? PROFILE_LABEL[presetOf(team.access.permissions, team.access.role)]
    : null;

  const discard = () => {
    setName(savedName);
    setBio(savedBio);
    setPreset(savedPreset);
    setAvatar(undefined);
    setBanner(undefined);
    setBannerFocus(0.5);
  };

  const save = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error("O apelido não pode ficar vazio.");
      return;
    }
    setSaving(true);
    try {
      const patch: ProfilePatch = {
        display_name: name.trim(),
        bio: bio.trim() || null,
        banner_preset: preset,
      };
      if (avatar === null) {
        await removeProfileImage(user.id, "avatar");
        patch.avatar_url = null;
      } else if (avatar) {
        const blob = await prepareImage(avatar.file, "avatar");
        patch.avatar_url = await uploadProfileImage(user.id, "avatar", blob);
      }
      if (banner === null) {
        await removeProfileImage(user.id, "banner");
        patch.banner_url = null;
      } else if (banner) {
        const blob = await prepareImage(banner.file, "banner", bannerFocus);
        patch.banner_url = await uploadProfileImage(user.id, "banner", blob);
      }
      await updateProfile(user.id, patch);
      await refreshProfile();
      setAvatar(undefined);
      setBanner(undefined);
      setBannerFocus(0.5);
      toast.success("Perfil atualizado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o perfil.");
    } finally {
      setSaving(false);
    }
  };

  const pick = (kind: "avatar" | "banner") => (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Escolha um arquivo de imagem.");
      return;
    }
    const next = { file, preview: URL.createObjectURL(file) };
    if (kind === "avatar") setAvatar(next);
    else {
      setBanner(next);
      setBannerFocus(0.5);
    }
    setSheet(null);
    setViewer(false);
  };

  return (
    <>
      {!asPage && (
        <div className="hidden md:block">
          <SettingsTabHeader title="Perfil" />
        </div>
      )}

      <div className={cn("profile-editor", dirty && "has-savebar")}>
        {/* ── Banner + foto ── */}
        <div className="profile-hero">
          <BannerArea
            src={bannerSrc ?? null}
            gradient={bannerCss(preset)}
            draggable={!!banner}
            focus={bannerFocus}
            onFocus={setBannerFocus}
            onEdit={() => setSheet("banner")}
          />

          <div className="profile-avatar-wrap">
            <button
              type="button"
              className="profile-avatar"
              onClick={() => (avatarSrc ? setViewer(true) : setSheet("avatar"))}
              aria-label={avatarSrc ? "Ver foto de perfil" : "Adicionar foto de perfil"}
            >
              {avatarSrc ? (
                <img src={avatarSrc} alt="" draggable={false} />
              ) : (
                <span className="profile-avatar-initials">{initialsOf(shownName)}</span>
              )}
            </button>
            <button
              type="button"
              className="profile-avatar-badge"
              onClick={() => setSheet("avatar")}
              aria-label="Trocar foto de perfil"
            >
              <Camera className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {/* ── Como os outros te veem ── */}
        <div className="profile-identity">
          <p className="profile-name">{shownName}</p>
          {bio.trim() && <p className="profile-bio">{bio.trim()}</p>}
          <div className="profile-chips">
            {company?.name && <span className="profile-chip">{company.name}</span>}
            {roleLabel && <span className="profile-chip">{roleLabel}</span>}
          </div>
        </div>

        {/* ── Campos ── */}
        <div className="profile-fields">
          <label className="profile-field">
            <span className="profile-field-label">
              Apelido
              <span className="profile-count">
                {name.length}/{NAME_MAX}
              </span>
            </span>
            <span className="profile-input">
              <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como a equipe vai te chamar"
                autoComplete="nickname"
              />
            </span>
            <span className="profile-help">Aparece para a equipe no chat, agenda e metas.</span>
          </label>

          <label className="profile-field">
            <span className="profile-field-label">
              Recado
              <span className={cn("profile-count", bio.length >= BIO_MAX && "text-amber-500")}>
                {bio.length}/{BIO_MAX}
              </span>
            </span>
            <textarea
              value={bio}
              maxLength={BIO_MAX}
              rows={3}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Ex.: Atendimento das 8h às 18h · Especialista em orçamentos"
              className="profile-textarea"
            />
          </label>

          <div className="profile-field">
            <span className="profile-field-label">Cor do banner</span>
            <BannerPresets
              value={preset}
              onChange={(id) => {
                setPreset(id);
                // Escolher um gradiente tira a imagem do banner.
                if (bannerSrc) dropBannerImage();
              }}
            />
            <span className="profile-help">
              {bannerSrc
                ? "Escolher uma cor remove a imagem atual do banner."
                : "Ou toque no banner para usar uma imagem sua."}
            </span>
          </div>
        </div>
      </div>

      {/* ── Barra de salvar (só com alterações) ── */}
      {dirty && (
        <div className="profile-savebar">
          <button type="button" className="profile-btn ghost" onClick={discard} disabled={saving}>
            Descartar
          </button>
          <button type="button" className="profile-btn primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Salvando…" : "Salvar perfil"}
          </button>
        </div>
      )}

      {/* ── Opções da foto ── */}
      {sheet === "avatar" && (
        <ActionSheet title="Foto de perfil" onClose={() => setSheet(null)}>
          {avatarSrc && (
            <SheetButton
              icon={Eye}
              label="Ver foto"
              onClick={() => {
                setSheet(null);
                setViewer(true);
              }}
            />
          )}
          <FileButton icon={ImagePlus} label="Escolher da galeria" onFile={pick("avatar")} />
          <FileButton icon={Camera} label="Tirar foto" capture="user" onFile={pick("avatar")} />
          {avatarSrc && (
            <SheetButton
              icon={Trash2}
              label="Remover foto"
              danger
              onClick={() => {
                setAvatar(profile?.avatar_url ? null : undefined);
                setSheet(null);
              }}
            />
          )}
        </ActionSheet>
      )}

      {/* ── Opções do banner ── */}
      {sheet === "banner" && (
        <ActionSheet title="Banner" onClose={() => setSheet(null)}>
          <FileButton icon={ImageIcon} label="Usar uma imagem" onFile={pick("banner")} />
          <div className="px-1 pt-2 pb-1">
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">Ou um gradiente</p>
            <BannerPresets
              value={bannerSrc ? "" : preset}
              onChange={(id) => {
                setPreset(id);
                if (bannerSrc) dropBannerImage();
                setSheet(null);
              }}
            />
          </div>
          {bannerSrc && (
            <SheetButton
              icon={Trash2}
              label="Remover imagem"
              danger
              onClick={() => {
                dropBannerImage();
                setSheet(null);
              }}
            />
          )}
        </ActionSheet>
      )}

      {/* ── Foto em tela cheia (estilo WhatsApp) ── */}
      {viewer && avatarSrc && (
        <div className="profile-viewer" role="dialog" aria-label="Foto de perfil">
          <header className="profile-viewer-bar">
            <button
              type="button"
              className="settings-icon-btn text-white"
              onClick={() => setViewer(false)}
              aria-label="Fechar foto"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="flex-1 truncate text-[16px] font-semibold">Foto do perfil</span>
            <button
              type="button"
              className="settings-icon-btn text-white"
              onClick={() => {
                setViewer(false);
                setSheet("avatar");
              }}
              aria-label="Editar foto"
            >
              <Pencil className="h-5 w-5" />
            </button>
          </header>
          <div className="profile-viewer-img" onClick={() => setViewer(false)}>
            <img src={avatarSrc} alt="Foto de perfil" />
          </div>
        </div>
      )}
    </>
  );
}

function BannerArea({
  src,
  gradient,
  draggable,
  focus,
  onFocus,
  onEdit,
}: {
  src: string | null;
  gradient: string;
  draggable: boolean;
  focus: number;
  onFocus: (v: number) => void;
  onEdit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; focus: number } | null>(null);

  // Imagem nova: arrastar na vertical escolhe a faixa que fica no banner.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!draggable) return;
    drag.current = { y: e.clientY, focus };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const h = ref.current.clientHeight || 1;
    const next = drag.current.focus - (e.clientY - drag.current.y) / (h * 2);
    onFocus(Math.min(1, Math.max(0, next)));
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      ref={ref}
      className={cn("profile-banner", draggable && "is-draggable")}
      style={{ background: gradient }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => !draggable && onEdit()}
    >
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{ objectPosition: `50% ${Math.round(focus * 100)}%` }}
        />
      )}
      {draggable && (
        <span className="profile-banner-hint">
          <Move className="h-3.5 w-3.5" /> Arraste para ajustar
        </span>
      )}
      <button
        type="button"
        className="profile-banner-edit"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Camera className="h-4 w-4" />
        <span>Editar banner</span>
      </button>
    </div>
  );
}

function BannerPresets({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="profile-presets" role="radiogroup" aria-label="Cor do banner">
      {BANNER_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          aria-label={p.label}
          title={p.label}
          className={cn("profile-preset", value === p.id && "is-active")}
          style={{ background: p.css }}
          onClick={() => onChange(p.id)}
        >
          {value === p.id && <Check className="h-4 w-4" />}
        </button>
      ))}
    </div>
  );
}

function ActionSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="profile-sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        className="profile-sheet"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="profile-sheet-grip" aria-hidden />
        <div className="profile-sheet-head">
          <span className="text-[15px] font-semibold">{title}</span>
          <button type="button" className="settings-icon-btn" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="profile-sheet-body">{children}</div>
      </div>
    </div>
  );
}

function SheetButton({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: typeof Eye;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("profile-sheet-row", danger && "is-danger")}
      onClick={onClick}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

function FileButton({
  icon: Icon,
  label,
  capture,
  onFile,
}: {
  icon: typeof Eye;
  label: string;
  capture?: "user" | "environment";
  onFile: (file: File) => void;
}) {
  const id = useMemo(() => `profile-file-${Math.random().toString(36).slice(2)}`, []);
  return (
    <label htmlFor={id} className="profile-sheet-row cursor-pointer">
      <Icon className="h-5 w-5" />
      {label}
      <input
        id={id}
        type="file"
        accept="image/*"
        capture={capture}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}
