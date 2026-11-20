import { useDemoRequest } from './DemoRequest.jsx';
import { CONTACT_EMAIL } from './contact.js';

// Every "Request a demo" control. In the markup it's a mail link, so a tap does something even
// before the page's JavaScript arrives: the prerendered page can sit unhydrated for seconds on
// conference Wi-Fi, and a <button> does nothing until then. Once the page is live the click opens
// the demo dialog instead. The markup is the same on the server and in the browser, so hydration is
// safe. `options` goes to open() (DemoRequest.jsx).
const DEMO_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Demo request')}`;

const DemoButton = ({ options, className, children }) => {
  const demo = useDemoRequest();
  return (
    <a
      href={DEMO_MAILTO}
      onClick={(e) => {
        e.preventDefault();
        demo.open(options);
      }}
      className={className}
    >
      {children}
    </a>
  );
};

export default DemoButton;
