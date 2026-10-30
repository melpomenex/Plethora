import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAssistantConversationScroll } from "../components/assistant/useAssistantConversationScroll";

interface Message { id: string; height: number }
const initial = (prefix: string): Message[] => Array.from({ length: 14 }, (_, i) => ({ id: `${prefix}-${i}`, height: 80 }));

function Conversation({ id, messages }: { id: string; messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = useAssistantConversationScroll(ref, id, true, messages);
  return <>
    <div ref={ref} onScroll={scroll.onScroll} data-scroll style={{ height: 300, overflowY: "auto", width: 400 }}>
      {messages.map((message, index) => <div key={message.id} data-assistant-message-id={message.id} style={index === 0 ? { minHeight: message.height } : { height: message.height }}>{message.id}</div>)}
    </div>
    {scroll.showLatest && <button onClick={scroll.showNewest}>Latest message</button>}
  </>;
}

function Harness() {
  const [id, setId] = useState("a");
  const [open, setOpen] = useState(true);
  const [conversations, setConversations] = useState<Record<string, Message[]>>({ a: initial("a"), b: initial("b") });
  return <>
    <button onClick={() => setId((old) => old === "a" ? "b" : "a")}>Switch</button>
    <button onClick={() => setOpen((old) => !old)}>Open or close</button>
    <button onClick={() => setConversations((old) => ({ ...old, [id]: [...old[id], { id: `${id}-${old[id].length}`, height: 80 }] }))}>Append</button>
    <button onClick={() => setConversations((old) => ({ ...old, [id]: old[id].map((m, i) => i === 0 ? { ...m, height: m.height + 100 } : m) }))}>Grow first</button>
    <button onClick={() => setConversations((old) => ({ ...old, [id]: old[id].filter((m) => m.id !== `${id}-4`) }))}>Remove anchor</button>
    <button onClick={() => setConversations((old) => ({ ...old, [id]: [] }))}>Clear</button>
    {open && <Conversation id={id} messages={conversations[id]} />}
  </>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
