import type { Metadata } from "next";
import Link from "next/link";
import { PublicLinks } from "../../components/public-links";
import "./coming-soon.css";

export const metadata: Metadata = {
  title: "Coming soon — Greedy Motion",
  description: "Greedy Motion is preparing a faster, clearer way to turn product updates into motion videos."
};

export default function ComingSoonPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 78% 10%, rgba(22,139,255,.35), transparent 30%), radial-gradient(circle at 10% 92%, rgba(255,188,157,.28), transparent 28%), #f7fbff",
        color: "#0a0d12"
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "min(1180px, calc(100% - 40px))",
          margin: "0 auto",
          padding: "24px 0"
        }}
      >
        <Link
          href="/"
          aria-label="Greedy Motion home"
          style={{ display: "flex", alignItems: "center", gap: "9px", color: "inherit", textDecoration: "none" }}
        >
          <img src="/brand/gm-mark.svg" alt="" style={{ width: "28px", height: "28px" }} />
          <span style={{ display: "flex", gap: "5px", fontSize: "18px", fontWeight: 700, letterSpacing: "-.03em" }}>
            <span style={{ color: "#0B1F4D" }}>Greedy</span>
            <span style={{ color: "#0A6CFF" }}>Motion</span>
          </span>
        </Link>
        <Link href="/" style={{ color: "#535862", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
          Back to home
        </Link>
      </header>

      <section
        className="coming-soon-hero"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 460px)",
          alignItems: "center",
          gap: "clamp(42px, 8vw, 120px)",
          width: "min(1080px, calc(100% - 40px))",
          minHeight: "calc(100vh - 92px)",
          margin: "0 auto",
          padding: "48px 0 96px"
        }}
      >
        <div>
          <p
            style={{
              display: "inline-flex",
              margin: "0 0 22px",
              padding: "7px 11px",
              borderRadius: "999px",
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(10,108,255,.16)",
              color: "#075ccc",
              fontFamily: "DMMono, monospace",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: ".08em"
            }}
          >
            COMING SOON
          </p>
          <h1
            style={{
              maxWidth: "680px",
              margin: 0,
              fontSize: "clamp(44px, 6vw, 78px)",
              fontWeight: 700,
              letterSpacing: "-.065em",
              lineHeight: ".98"
            }}
          >
            Product video,
            <br />
            without the production maze.
          </h1>
          <p style={{ maxWidth: "560px", margin: "26px 0 0", color: "#535862", fontSize: "18px", lineHeight: 1.6 }}>
            Greedy Motion is being prepared to turn product updates into clear, on-brand motion stories.
          </p>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              marginTop: "34px",
              padding: "13px 21px",
              borderRadius: "999px",
              background: "#181d27",
              boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12",
              color: "#fff",
              fontSize: "15px",
              fontWeight: 600,
              textDecoration: "none"
            }}
          >
            Explore Greedy Motion
          </Link>
        </div>

        <div
          aria-hidden="true"
          style={{ padding: "14px", borderRadius: "30px", background: "#0c1320", boxShadow: "0 28px 70px rgba(28, 80, 142, .24)" }}
        >
          <div
            style={{
              minHeight: "420px",
              padding: "30px",
              borderRadius: "20px",
              background: "radial-gradient(circle at 75% 15%, rgba(21,125,255,.48), transparent 28%), linear-gradient(140deg, #102451, #1b376e)",
              color: "#fff"
            }}
          >
            <div style={{ display: "flex", gap: "7px" }}>
              {["#9bc7ff", "#9bc7ff", "#9bc7ff"].map((color, index) => (
                <i key={index} style={{ width: "7px", height: "7px", borderRadius: "50%", background: color }} />
              ))}
            </div>
            <p style={{ margin: "68px 0 12px", color: "#a9d1ff", fontFamily: "DMMono, monospace", fontSize: "11px", letterSpacing: ".08em" }}>
              GREEDY MOTION
            </p>
            <p style={{ maxWidth: "300px", margin: 0, fontFamily: "InstrumentSerif, Georgia, serif", fontSize: "clamp(42px, 5vw, 56px)", lineHeight: ".92" }}>
              Your next update, in motion.
            </p>
            <div style={{ display: "grid", gap: "10px", marginTop: "54px" }}>
              {["Shape the story", "Review the motion", "Share the result"].map((label, index) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: "11px", padding: "12px 14px", border: "1px solid rgba(255,255,255,.18)", borderRadius: "12px", background: "rgba(255,255,255,.08)" }}>
                  <span style={{ color: "#8fc0ff", fontFamily: "DMMono, monospace", fontSize: "11px" }}>0{index + 1}</span>
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <footer style={{ maxWidth: 1100, margin: "auto", padding: "24px" }}><PublicLinks /></footer>
    </main>
  );
}
