import { useEffect, useRef, useState } from 'react';

const SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4';

/** Hero video with a gradient fallback (the .bg CSS) if it fails, is slow, or motion is reduced. */
export default function VideoBg() {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 600;
    if (calm) ref.current?.pause();
  }, []);

  return (
    <div className="bg">
      {!failed && (
        <video ref={ref} className="bg-video" autoPlay muted loop playsInline onError={() => setFailed(true)}>
          <source src={SRC} type="video/mp4" onError={() => setFailed(true)} />
        </video>
      )}
    </div>
  );
}
