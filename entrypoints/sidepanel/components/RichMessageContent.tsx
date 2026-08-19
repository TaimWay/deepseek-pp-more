import { useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface RichMessageContentProps {
  text: string;
  onRendered?: () => void;
}

export default function RichMessageContent({ text, onRendered }: RichMessageContentProps) {
  useLayoutEffect(() => {
    onRendered?.();
  }, [onRendered]);

  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{text}</ReactMarkdown>;
}
