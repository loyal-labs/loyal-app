import type { Metadata } from "next";

import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Privacy Policy - Loyal",
  description:
    "Privacy Policy for AskLoyal / Loyal services. Learn how we handle your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "#FFFFFF",
        color: "#000000",
      }}
    >
      <main
        style={{
          flex: 1,
          padding: "120px 16px 64px",
          maxWidth: "800px",
          margin: "0 auto",
          width: "100%",
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "15px",
          lineHeight: 1.7,
        }}
      >
        <h1
          style={{
            fontSize: "32px",
            fontWeight: 600,
            textAlign: "center",
            marginBottom: "4px",
          }}
        >
          Loyal Privacy Policy
        </h1>
        <p
          style={{
            textAlign: "center",
            color: "#666",
            marginBottom: "48px",
          }}
        >
          <strong>Effective Date:</strong> 23 February 2026
        </p>

        <Section number="1" title="Introduction">
          <p>
            This Privacy Policy explains how <strong>AskLoyal / Loyal</strong>,
            including its affiliates and related services (collectively
            &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;Loyal&rdquo;),
            processes your data collected through the website
            https://askloyal.com (&ldquo;Website&rdquo;) and related services,
            and describes your rights under applicable privacy laws.
          </p>
          <p>
            We are committed to protecting your privacy and ensuring that your
            data is handled in a safe and responsible manner.
          </p>
        </Section>

        <Section number="2" title="Information We Collect">
          <SubSection number="2.1" title="Log Data">
            <p>
              When you visit or interact with the Website, certain information is
              automatically collected, including your IP address, user agent
              (browser type and settings), device and network identifiers,
              requested pages/URLs, referring pages, the date and time of
              requests, as well as error, security, and anti-abuse logs
              (&ldquo;Log Data&rdquo;). We use this information to operate and
              maintain the Website, ensure security, and improve our services.
            </p>
          </SubSection>
          <SubSection number="2.2" title="Information You Provide">
            <p>
              We do not collect your personal data directly through the Website.
              User authentication is handled via third-party identity providers.
              Any personal data processed during authentication is handled by
              such providers in accordance with their own privacy policies.
            </p>
          </SubSection>
          <SubSection number="2.3" title="Cookies and Tracking Technologies">
            <p>
              We use cookies and similar technologies to operate and administer
              our services and to improve your experience with the Website.
            </p>
            <p>
              You can manage or delete cookies through your browser settings, but
              some functionalities may require cookies to work.
            </p>
          </SubSection>
        </Section>

        <Section number="3" title="How We Use Your Data">
          <p>
            We may use the Log Data and authentication identifiers for the
            following purposes:
          </p>
          <ul style={{ paddingLeft: "24px", marginBottom: "16px" }}>
            <li>To provide and improve our Website and services</li>
            <li>
              To develop new features and functionalities that enhance user
              experience and security
            </li>
            <li>
              To understand how our services are used. This helps us optimize
              functionality, assess engagement, and track interactions with
              features to enhance performance
            </li>
          </ul>
          <p>
            We do not use your data for targeted advertising, and we do not send
            marketing communications.
          </p>
        </Section>

        <Section number="4" title="Third-Party Links">
          <p>
            Our Website may contain links to third-party websites or services
            that are not operated by Loyal. Loyal is not responsible for
            third-party breaches, data misuse, or security failures. Users
            should review the privacy policies of these third parties.
          </p>
        </Section>

        <Section number="5" title="Data Retention">
          <p>
            We retain data only as long as necessary to fulfill the purposes
            outlined in this Privacy Policy, to comply with legal obligations,
            resolve disputes, and enforce agreements.
          </p>
        </Section>

        <Section number="6" title="Limitation of Liability">
          <p>
            Loyal assumes no liability for the content users create, store, or
            share through our services. Loyal is not responsible for third-party
            breaches or data compromises. Loyal shall not be liable for
            interruptions, delays, or inability to provide the services due to
            reasons beyond its control, including but not limited to force
            majeure events, natural disasters, cyber-attacks, or governmental
            actions. To the maximum extent permitted by law, Loyal&rsquo;s total
            liability shall not exceed the amount paid by the user for the
            services within the preceding one (1) month.
          </p>
        </Section>

        <Section number="7" title="Force Majeure">
          <p>
            Loyal shall not be liable for any failure or delay in the performance
            of its obligations under this Privacy Policy due to causes beyond its
            reasonable control, including but not limited to acts of God, natural
            disasters, pandemics, governmental restrictions, cyber-attacks,
            telecommunications failures, or power outages. In such cases,
            performance obligations shall be suspended for the duration of the
            force majeure event.
          </p>
        </Section>

        <Section number="8" title="International Transfers">
          <p>
            If you are located outside the country where your data is processed,
            you consent to the transfer of your data to countries that may have
            different data protection laws.
          </p>
        </Section>

        <Section number="9" title="Data Security">
          <p>
            We employ industry-standard security measures to protect user
            information. However, no system is completely secure, and we cannot
            guarantee absolute security.
          </p>
        </Section>

        <Section number="10" title="Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. The updated
            version will be posted on this page with an updated effective date.
          </p>
        </Section>

        <Section number="11" title="Contact Us">
          <p>
            If you have any questions or concerns about this Privacy Policy or
            our data processing practices, you may contact us at:
          </p>
          <p>
            <strong>Loyal</strong>
            <br />
            Email: main@askloyal.com
            <br />
            Address: Loyal DAO LLC, 852 Lagoon Road, Majuro, Marshall Islands,
            96960
          </p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: "32px" }}>
      <h2
        style={{
          fontSize: "20px",
          fontWeight: 600,
          marginBottom: "12px",
        }}
      >
        {number}. {title}
      </h2>
      {children}
    </section>
  );
}

function SubSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "16px", paddingLeft: "16px" }}>
      <h3
        style={{
          fontSize: "17px",
          fontWeight: 600,
          marginBottom: "8px",
        }}
      >
        {number}. {title}
      </h3>
      {children}
    </div>
  );
}
