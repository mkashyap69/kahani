import { ThemeForm } from "@/components/theme-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function NewTheme() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="New theme" description="After creating it, add characters, locations and the storyline bible." />
      <Card>
        <CardContent className="pt-5">
          <ThemeForm />
        </CardContent>
      </Card>
    </div>
  );
}
