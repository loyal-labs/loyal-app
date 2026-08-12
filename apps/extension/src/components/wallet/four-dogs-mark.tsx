import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// FourDogsMark — animated "loyal" wordmark with three dog heads peeking up
// through the letters o / y / a. Each head slides in from below, clipped by a
// letter-shaped mask so it reads as emerging from inside the letter, then
// settles into a gentle asynchronous breathing loop. Once the entrance has
// completed, clicking the mark toggles all three heads between visible and
// tucked-back-into-the-letters.
// ---------------------------------------------------------------------------

// Show/hide timings mirror each other — same duration, reversed stagger (o
// leads the show, a leads the hide) and reversed easing (ease-out for show,
// ease-in for hide). Last-to-move dog dictates total duration.
const SHOW_DURATION_MS = 750;
const SHOW_STAGGER_START_MS = 180;
const SHOW_STAGGER_STEP_MS = 220;
const SHOW_TOTAL_MS =
  SHOW_STAGGER_START_MS + 2 * SHOW_STAGGER_STEP_MS + SHOW_DURATION_MS;

// Entrance and idle animate the same property (transform), so we split them
// across two nested <g> wrappers — outer plays show/hide, inner plays the
// breathing loop. Entrance offset is 440px to fully clear the 'y' letter's
// descender mask (which extends to y≈596); o/a's smaller masks still hide
// the extra travel. Each dog gets its own idle keyframe with different
// amplitudes and coprime-ish durations so they drift independently.
const STYLE = `
  @keyframes four-dogs-show-v {
    from { transform: translateY(440px); }
    to { transform: translateY(0); }
  }
  @keyframes four-dogs-hide-v {
    from { transform: translateY(0); }
    to { transform: translateY(440px); }
  }
  @keyframes four-dogs-show-h {
    from { transform: translateX(440px); }
    to { transform: translateX(0); }
  }
  @keyframes four-dogs-hide-h {
    from { transform: translateX(0); }
    to { transform: translateX(440px); }
  }
  @keyframes four-dogs-idle-o {
    0%   { transform: translateY(0); }
    35%  { transform: translateY(-12px); }
    55%  { transform: translateY(-4px); }
    100% { transform: translateY(0); }
  }
  @keyframes four-dogs-idle-y {
    0%   { transform: translateY(0); }
    22%  { transform: translateY(-5px); }
    48%  { transform: translateY(-11px); }
    72%  { transform: translateY(-3px); }
    100% { transform: translateY(0); }
  }
  @keyframes four-dogs-idle-a {
    0%   { transform: translateY(0); }
    45%  { transform: translateY(-15px); }
    70%  { transform: translateY(-6px); }
    100% { transform: translateY(0); }
  }
  .four-dogs-show-o {
    animation: four-dogs-show-h 0.75s cubic-bezier(0.22, 1, 0.36, 1) 180ms both;
  }
  .four-dogs-show-y {
    animation: four-dogs-show-h 0.75s cubic-bezier(0.22, 1, 0.36, 1) 400ms both;
  }
  .four-dogs-show-a {
    animation: four-dogs-show-v 0.75s cubic-bezier(0.22, 1, 0.36, 1) 620ms both;
  }
  .four-dogs-hide-a {
    animation: four-dogs-hide-v 0.75s cubic-bezier(0.64, 0, 0.78, 0) 0ms both;
  }
  .four-dogs-hide-y {
    animation: four-dogs-hide-h 0.75s cubic-bezier(0.64, 0, 0.78, 0) 220ms both;
  }
  .four-dogs-hide-o {
    animation: four-dogs-hide-h 0.75s cubic-bezier(0.64, 0, 0.78, 0) 440ms both;
  }
  .four-dogs-idle-o {
    animation: four-dogs-idle-o 3.4s ease-in-out 1100ms infinite;
  }
  .four-dogs-idle-y {
    animation: four-dogs-idle-y 2.7s ease-in-out 1500ms infinite;
  }
  .four-dogs-idle-a {
    animation: four-dogs-idle-a 4.1s ease-in-out 1900ms infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .four-dogs-show-o, .four-dogs-show-y, .four-dogs-show-a,
    .four-dogs-hide-o, .four-dogs-hide-y, .four-dogs-hide-a,
    .four-dogs-idle-o, .four-dogs-idle-y, .four-dogs-idle-a {
      animation: none;
    }
  }
`;

export function FourDogsMark({ size = 240 }: { size?: number }) {
  const h = Math.round(size * (597 / 1393));
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), SHOW_TOTAL_MS + 50);
    return () => clearTimeout(t);
  }, []);

  const handleToggle = useCallback(() => {
    if (!ready) return;
    setVisible((v) => !v);
  }, [ready]);

  const classFor = (dog: "o" | "y" | "a") =>
    visible ? `four-dogs-show-${dog}` : `four-dogs-hide-${dog}`;

  return (
    <div
      onClick={handleToggle}
      style={{
        cursor: ready ? "pointer" : "default",
        display: "inline-block",
        userSelect: "none",
      }}
    >
      <style>{STYLE}</style>
      <svg
        viewBox="0 0 1393 597"
        width={size}
        height={h}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block" }}
        aria-label="loyal"
      >
        <defs>
          <mask
            id="four-dogs-mask-o"
            maskUnits="userSpaceOnUse"
            x="150"
            y="116"
            width="365"
            height="385"
          >
            <path
              d="M332.683 500.791C222.409 500.791 150.28 425.194 150.28 308.678C150.28 192.161 222.409 116.564 332.683 116.564C442.264 116.564 514.393 192.161 514.393 308.678C514.393 425.194 442.264 500.791 332.683 500.791Z"
              fill="white"
            />
          </mask>
          <mask
            id="four-dogs-mask-a"
            maskUnits="userSpaceOnUse"
            x="850"
            y="116"
            width="371"
            height="385"
          >
            <path
              d="M856.9 237.242C871.464 160.258 930.416 116.564 1021.27 116.564C1127.38 116.564 1182.87 171.355 1182.87 274.694V400.92C1182.87 421.726 1191.88 427.968 1205.75 427.968H1220.32V492.468L1199.51 493.162C1171.08 493.855 1112.82 494.549 1105.88 436.291C1088.55 473.049 1046.93 500.791 983.126 500.791C908.916 500.791 850.658 461.259 850.658 396.065C850.658 325.323 861.061 208.651 947.755 192.006L1093.4 264.291C1093.4 207.419 1069.13 180.371 1021.27 180.371C981.738 180.371 956.077 201.871 947.755 242.097L856.9 237.242Z"
              fill="white"
            />
          </mask>
          <mask
            id="four-dogs-mask-y"
            maskUnits="userSpaceOnUse"
            x="497"
            y="-5"
            width="366"
            height="602"
          >
            <path
              d="M497.095 124.84H583.095L693.587 -4.7207L799.916 73.9324L862.596 124.84L716.257 531.26C700.305 576.341 670.483 596.454 621.241 596.454H560.902V528.486H605.982C627.483 528.486 637.886 521.55 645.515 504.212L655.918 477.163H630.257L497.095 124.84Z"
              fill="white"
            />
          </mask>

          <clipPath id="four-dogs-clip-o-mouth" clipPathUnits="userSpaceOnUse">
            <path d="M400.022 371.943C424.776 373.24 443.931 391.683 442.807 413.136L353.166 408.438C354.291 386.985 375.269 370.645 400.022 371.943Z" />
          </clipPath>
          <clipPath id="four-dogs-clip-a-mouth" clipPathUnits="userSpaceOnUse">
            <path d="M947.764 424.279L944.246 462.486L1089.97 418.985L1098.03 375.51L947.764 424.279Z" />
          </clipPath>
          <clipPath id="four-dogs-clip-a-eye" clipPathUnits="userSpaceOnUse">
            <path d="M948.878 360.646C924.851 366.93 909.789 388.904 915.235 409.727L1002.24 386.971C996.796 366.148 972.904 354.362 948.878 360.646Z" />
          </clipPath>
        </defs>

        {/* "loyal" wordmark */}
        <path
          d="M1248.58 0H1337.36V396.71C1337.36 414.049 1347.07 423.759 1364.41 423.759H1392.15V492.42H1341.52C1286.04 492.42 1248.58 457.743 1248.58 400.178V0Z"
          fill="black"
        />
        <path
          d="M856.9 237.241C871.464 160.257 930.416 116.562 1021.27 116.562C1127.39 116.562 1182.87 171.353 1182.87 274.693V400.92C1182.87 421.727 1191.89 427.969 1205.76 427.969H1220.32V492.47L1199.52 493.163C1171.08 493.857 1112.82 494.551 1105.89 436.292C1088.55 473.05 1046.93 500.793 983.127 500.793C908.916 500.793 850.658 461.26 850.658 396.066C850.658 325.323 904.061 301.048 990.756 284.403L1093.4 264.29C1093.4 207.418 1069.13 180.37 1021.27 180.37C981.74 180.37 956.078 201.87 947.755 242.096L856.9 237.241ZM942.9 393.291C942.9 418.259 964.401 438.372 1007.4 438.372C1057.34 438.372 1095.48 401.614 1095.48 329.484V324.629L1025.43 337.113C978.965 345.436 942.9 351.678 942.9 393.291Z"
          fill="black"
        />
        <path
          d="M497.095 124.84H583.095L681.579 399.485L776.596 124.84H862.596L716.257 531.26C700.305 576.341 670.483 596.453 621.24 596.453H560.902V528.486H605.982C627.482 528.486 637.886 521.55 645.515 504.211L655.918 477.163H630.257L497.095 124.84Z"
          fill="black"
        />
        <path
          d="M332.685 500.793C222.41 500.793 150.28 425.195 150.28 308.678C150.28 192.16 222.41 116.562 332.685 116.562C442.267 116.562 514.397 192.16 514.397 308.678C514.397 425.195 442.267 500.793 332.685 500.793ZM242.523 308.678C242.523 384.275 275.12 428.663 332.685 428.663C389.557 428.663 422.847 384.275 422.847 308.678C422.847 233.08 389.557 188.692 332.685 188.692C275.12 188.692 242.523 233.08 242.523 308.678Z"
          fill="black"
        />
        <path
          d="M0 0H88.7743V396.71C88.7743 414.049 98.484 423.759 115.823 423.759H143.565V492.42H92.9356C37.4517 492.42 0 457.743 0 400.178V0Z"
          fill="black"
        />

        {/* 'o' dog — outer <g> holds the mask (letter-anchored, stationary);
            nested inner groups stack entrance + idle transforms independently. */}
        <g mask="url(#four-dogs-mask-o)">
          <g className={classFor("o")}>
            <g className="four-dogs-idle-o">
              <path
                d="M279.32 451.954L234.438 347.23H369.084V242.506L428.926 347.23L443.887 242.506L533.65 481.876L279.32 451.954Z"
                fill="#F9363C"
              />
              <path
                d="M400.022 371.943C424.776 373.24 443.931 391.683 442.807 413.136L353.166 408.438C354.291 386.985 375.269 370.645 400.022 371.943Z"
                fill="white"
              />
              <g clipPath="url(#four-dogs-clip-o-mouth)">
                <circle
                  cx="398.814"
                  cy="399.69"
                  r="24.2065"
                  transform="rotate(3 398.814 399.69)"
                  fill="black"
                />
              </g>
            </g>
          </g>
        </g>

        {/* 'a' dog */}
        <g mask="url(#four-dogs-mask-a)">
          <g className={classFor("a")}>
            <g className="four-dogs-idle-a">
              <path
                d="M1086.15 439.612L1109.96 311.169L977.84 338.427L956.64 235.668L919.121 350.541L883.241 250.811L842.65 520.458L1086.15 439.612Z"
                fill="#F9363C"
              />
              <path
                d="M947.764 424.279L944.246 462.486L1089.97 418.985L1098.03 375.51L947.764 424.279Z"
                fill="white"
              />
              <g clipPath="url(#four-dogs-clip-a-mouth)">
                <path
                  d="M1093.66 404.551L1066.02 398.844L1038.61 423.405L1013.62 416.99L977.436 442.831L941.356 436.339"
                  stroke="black"
                  strokeWidth="8.9934"
                />
              </g>
              <path
                d="M948.878 360.646C924.852 366.93 909.789 388.904 915.235 409.727L1002.24 386.971C996.797 366.148 972.904 354.362 948.878 360.646Z"
                fill="white"
              />
              <g clipPath="url(#four-dogs-clip-a-eye)">
                <circle
                  cx="20.2351"
                  cy="20.2351"
                  r="20.2351"
                  transform="matrix(-0.967457 0.253035 0.253035 0.967457 964.799 370.477)"
                  fill="black"
                />
              </g>
            </g>
          </g>
        </g>

        {/* 'y' dog */}
        <g mask="url(#four-dogs-mask-y)">
          <g className={classFor("y")}>
            <g className="four-dogs-idle-y">
              <path
                d="M599.13 316.466L571.235 205.774L704.455 227.003L720.966 123.388L763.664 236.439L794.978 135.182L846.05 386.17L599.13 316.466Z"
                fill="#F9363C"
              />
              <path
                d="M764.652 299.294C766.892 290.251 764.493 281.009 758.844 273.548C753.703 266.757 745.869 261.441 736.392 259.093C726.981 256.761 717.636 257.775 709.948 261.321C701.391 265.268 694.888 272.352 692.633 281.453"
                stroke="black"
                strokeWidth="8.9934"
              />
              <path
                d="M654.791 296.503C653.12 301.948 648.527 305.902 642.548 307.809C637.176 309.521 630.686 309.582 624.189 307.588C617.648 305.58 612.28 301.85 608.797 297.377"
                stroke="black"
                strokeWidth="8.9934"
              />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
