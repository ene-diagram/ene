# Changesets

사용자에게 보이는 변경이 있는 PR 은 `pnpm changeset` 으로 변경 기록을 하나 추가한다.
main 에 머지되면 Release 워크플로가 "Version Packages" PR 을 열고, 그 PR 을 머지하면 npm 에 배포된다.
