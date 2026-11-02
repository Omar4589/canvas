// A real device screenshot in a minimal phone shell (the screenshot already carries the iOS status
// bar, so no extra notch). Rounded to mimic the screen corners. Lazy: it sits below the fold
// wherever it's used.
const PhoneShot = ({ src, alt, className = '' }) => {
  return (
    <div
      className={`overflow-hidden rounded-[2rem] border border-stone-200 bg-white p-2 shadow-[0_20px_60px_rgba(28,25,23,0.16)] ${className}`}
    >
      <img
        src={src}
        alt={alt}
        width="1206"
        height="2622"
        loading="lazy"
        decoding="async"
        className="block w-full rounded-[1.5rem]"
      />
    </div>
  );
};

export default PhoneShot;
