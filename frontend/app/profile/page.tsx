import type { Metadata } from "next";
import { ProfilePage } from "../../components/profile-page";

export const metadata: Metadata = { title: "Profile · Greedy Motion" };

export default function Profile() {
  return <ProfilePage />;
}
