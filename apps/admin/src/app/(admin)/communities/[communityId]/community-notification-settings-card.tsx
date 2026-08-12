import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ChevronDown } from "lucide-react"

import { updateCommunityNotificationSettings } from "./community-notification-settings-actions"

type CommunityNotificationSettingsCardProps = {
  communityId: string
  settings: {
    isActive: boolean
    isPublic: boolean
    summaryNotificationsEnabled: boolean
    summaryNotificationTimeHours: 24 | 48 | null
    summaryNotificationMessageCount: 500 | 1000 | null
  }
}

export function CommunityNotificationSettingsCard({
  communityId,
  settings,
}: CommunityNotificationSettingsCardProps) {
  const updateAction = updateCommunityNotificationSettings.bind(null, communityId)
  const perDayValue = settings.summaryNotificationTimeHours
    ? String(settings.summaryNotificationTimeHours)
    : "off"
  const perMessageValue = settings.summaryNotificationMessageCount
    ? String(settings.summaryNotificationMessageCount)
    : "off"

  return (
    <Card>
      <details className="group">
        <summary className="flex list-none cursor-pointer items-start justify-between gap-4 px-6 py-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle>Settings</CardTitle>
            <CardDescription>Adjust how and when summaries are sent for this community.</CardDescription>
          </div>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <form action={updateAction} className="border-t">
          <CardContent className="space-y-5 pt-6">
            <div className="flex flex-col gap-3 rounded-md border p-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Master switch</p>
                <p className="text-sm text-muted-foreground">Turn all summary notifications on or off.</p>
              </div>
              <div className="flex flex-wrap items-center gap-4 md:justify-end">
                <div className="flex items-center gap-2">
                  <Label htmlFor="master-switch" className="text-xs text-muted-foreground">
                    Notifications
                  </Label>
                  <Switch
                    id="master-switch"
                    name="masterSwitch"
                    defaultChecked={settings.summaryNotificationsEnabled}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="active-switch" className="text-xs text-muted-foreground">
                    Active
                  </Label>
                  <Switch id="active-switch" name="isActive" defaultChecked={settings.isActive} />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="public-switch" className="text-xs text-muted-foreground">
                    Public
                  </Label>
                  <Switch id="public-switch" name="isPublic" defaultChecked={settings.isPublic} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="per-day">Per day</Label>
                <Select defaultValue={perDayValue} name="perDay">
                  <SelectTrigger id="per-day">
                    <SelectValue placeholder="Select per day frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="24">24h</SelectItem>
                    <SelectItem value="48">48h</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="per-message">Per msg</Label>
                <Select defaultValue={perMessageValue} name="perMessage">
                  <SelectTrigger id="per-message">
                    <SelectValue placeholder="Select per message threshold" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1000">1000</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end border-t pt-6">
            <Button type="submit">Save settings</Button>
          </CardFooter>
        </form>
      </details>
    </Card>
  )
}
