import {Monitor,Moon,Sun} from 'lucide-react';
import {useTheme} from 'next-themes';
import {Button} from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function ThemeToggle() {
  const {theme,setTheme}=useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="화면 테마">
          <Sun aria-hidden="true" className="dark:hidden"/>
          <Moon aria-hidden="true" className="hidden dark:block"/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" className="gap-2">
            <Sun aria-hidden="true" className="size-4 shrink-0"/>
            밝게
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="gap-2">
            <Moon aria-hidden="true" className="size-4 shrink-0"/>
            어둡게
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="gap-2">
            <Monitor aria-hidden="true" className="size-4 shrink-0"/>
            시스템 설정 따르기
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
