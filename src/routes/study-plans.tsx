import { StudyPlansTab } from '../components/study-plans/StudyPlansTab';

export function StudyPlansRoute() {
  return (
    <div className="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain bg-background">
      <StudyPlansTab />
    </div>
  );
}

export default StudyPlansRoute;
