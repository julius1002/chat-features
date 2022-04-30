import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ChatComponent } from './components/chat.component';

const routes: Routes = [
  { path: '', redirectTo: '/chat/0', pathMatch: 'full' },
  {
    path: 'chat/:roomId',
    component: ChatComponent
  }];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
