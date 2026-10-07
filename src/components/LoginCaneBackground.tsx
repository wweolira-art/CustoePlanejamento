const CANE_PHOTO = "/login-cane-field.jpg";

export function LoginCaneBackground() {
  return (
    <div className="login-cane-scene" aria-hidden="true">
      <img
        className="login-cane-photo"
        src={CANE_PHOTO}
        alt=""
        decoding="async"
        fetchPriority="high"
      />

      <div className="login-cane-vignette" />
      <div className="login-cane-overlay" />
    </div>
  );
}
