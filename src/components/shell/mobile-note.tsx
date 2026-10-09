// Shown on phones only (CSS): the tool is for reading there, entry needs a wider screen.
import { IconInfo } from '@/components/ui/icons';

export function MobileNote() {
  return (
    <p className="ui-mobile-note ui-banner ui-banner--info ui-banner--flush" role="note">
      <span className="ui-banner__icon">
        <IconInfo />
      </span>
      <span className="ui-banner__body">Phone view is read only. Use a tablet or desktop to enter figures.</span>
    </p>
  );
}
