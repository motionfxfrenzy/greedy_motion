import { EditorApp } from "../../../components/editor/EditorApp";

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <EditorApp projectId={projectId} />;
}
