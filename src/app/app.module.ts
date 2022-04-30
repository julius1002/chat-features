import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ChatComponent } from './components/chat.component';
import { DelayDirective } from './directives/delay.directive';
import { ZoomDirective } from './directives/zoom.directive';

@NgModule({
  declarations: [
    AppComponent,
    ChatComponent,
    DelayDirective,
    ZoomDirective
  ],
  imports: [
    BrowserModule,
    AppRoutingModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
