import { AfterContentInit, AfterViewInit, Component, ElementRef, Inject, OnInit, Renderer2, ViewChild, ViewChildren } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import * as R from 'ramda';
import { AsyncSubject, BehaviorSubject, catchError, concatMap, debounceTime, distinctUntilChanged, EMPTY, exhaustMap, filter, from, fromEvent, interval, map, merge, mergeMap, MonoTypeOperatorFunction, Observable, of, OperatorFunction, pairwise, pipe, pluck, ReplaySubject, retry, RetryConfig, scan, startWith, Subject, switchMap, take, tap, timer, toArray, withLatestFrom, zip } from 'rxjs';
import { ajax } from 'rxjs/ajax';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

interface Message {
  user: string;
  message: string;
  type: string;
  room: string;
  time: number;
  id: string;
  gif: string;
  preview_image?: string;
  preview_description?: string;
  bahn_connections?: any;
  img?: string;
  after?: string;
  before?: string;
  reaction?: string;
  messageId: string
}

interface TypingEvent {
  type?: string,
  user?: string,
  room?: string
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, AfterContentInit {

  @ViewChild('sendBtn', { static: true }) sendBtn: ElementRef | undefined;
  @ViewChild('sendInput', { static: true }) sendInput: ElementRef | undefined;

  @ViewChild('authBtn', { static: true }) authBtn: ElementRef | undefined;
  @ViewChild('nameInput', { static: true }) nameInput: ElementRef | undefined;

  @ViewChild('inputGroup', { static: true }) inputGroup: ElementRef | undefined;

  @ViewChild('chat', { static: true }) chatUl: ElementRef | undefined;
  @ViewChild('addRoomBtn', { static: true }) addRoomBtn: ElementRef | undefined;

  @ViewChild('uploadInput', { static: true }) uploadInput: ElementRef | undefined;

  @ViewChildren("messageElements") messageElements: any;

  @ViewChild('chat') chat!: ElementRef;

  public reactionsIndex$ = new Subject<number>();

  messages$ = new ReplaySubject<Message[]>(100);

  messageInCurrentRoom$: Observable<Message[]> = of([]);

  typingStream$ = new BehaviorSubject<TypingEvent>({});

  showSendButton$: Observable<any> = EMPTY;

  user$ = new BehaviorSubject<any>(undefined);

  userExists$: Observable<any> = EMPTY;

  rooms$: Observable<any> = EMPTY

  imgPreview$ = new BehaviorSubject<any[]>([]);

  weatherPreview$ = new BehaviorSubject<any>(undefined);

  linkPreview$ = new BehaviorSubject<any>(undefined);

  bahnConnections$ = new BehaviorSubject<any>(undefined);

  gifs$ = new BehaviorSubject<any>(undefined)

  backendUri = "http://localhost:3000"

  unreadMessagesByRoom$: Subject<any> = new Subject();

  ws$: WebSocketSubject<any> = webSocket(`ws://${this.backendUri.split("//")[1]}/ws`)

  currentRoomId$: Observable<any> = EMPTY;

  constructor(private render2: Renderer2, private route: ActivatedRoute, private sanitizer: DomSanitizer) { }

  ngOnInit(): void {

    fromEvent(document, "click")
      .pipe(pluck("target"),
        filter(({ classList }: any) => R.not(R.includes("someoneElseMsg", classList) || R.includes("content", classList) || R.includes("author", classList))),
        map(() => -1),
      ).subscribe(this.reactionsIndex$)

    /* Declarations 
    */
    const onTypingToInput$ = fromEvent(this.nameInput?.nativeElement, "keyup")
    const loggedInUser$ = new AsyncSubject<any>();
    const onAuthButtonClick$ = fromEvent(this.authBtn?.nativeElement, "click")
    const onInputToSend$ = fromEvent(this.sendInput?.nativeElement, "keyup")
    const onSendButtonClicked$ = fromEvent(this.sendBtn?.nativeElement, "click")


    /* asyncsubject emits a single value to all new subscribers,
     perfect fit for logged in user to avoid redundant requests*/

    /*____________________________________________________________________ USER MANAGEMENT START ____________________________________________________________________ */


    const hideEl: (a: any) => void
      = (element: any) => this.render2.setAttribute(element, "style", "display:none")

    loggedInUser$.subscribe(this.user$)

    if (localStorage.getItem("savedUsername")) {
      this.user$.next({ name: localStorage.getItem("savedUsername") })
      this.userExists$ = of(true);
      hideEl(this.nameInput?.nativeElement)
      hideEl(this.authBtn?.nativeElement)
    }

    onTypingToInput$.pipe(
      pluck("target", "value"),
      filter(R.pipe(R.isEmpty, R.not)),
      switchMap((name: any) =>
        ajax(`${this.backendUri}/api/reactiveForms/usernameCheck/${name}`)
          .pipe(pluck("response"))),
      map((value: any) => R.not(R.prop("taken")(value))))

    const authenticateUserAt: (a: string) => (b: string) => Observable<any>
      = (endpoint: string) => (username: string) => ajax(endpoint + username).pipe(pluck("response"))

    merge(
      onAuthButtonClick$,
      onTypingToInput$
        .pipe(
          filter((keyboardEvent: any) => keyboardEvent.keyCode === 13)),
    ).pipe(
      map(() => this.nameInput?.nativeElement.value),
      switchMap(authenticateUserAt(`${this.backendUri}/api/authenticate/`)),
      catchError((err, caught) => merge(of(err), caught)
      ) // without catcherror, the observable will complete
    ).subscribe(response => {
      if (response.status > 400 || response.status < 200) {
        return;
      }
      localStorage.setItem("savedUsername", response.name)
      hideEl(this.nameInput?.nativeElement)
      hideEl(this.authBtn?.nativeElement)
      loggedInUser$.next(response);
      loggedInUser$.complete()
    })

    this.render2.setAttribute(this.sendInput?.nativeElement, "value", localStorage.getItem("savedMessage") ? localStorage.getItem("savedMessage")! : "")


    /*____________________________________________________________________ ROOMS START ____________________________________________________________________ */



    /*
websocket consumes and produces events from type message and typing
*/

    this.rooms$ = ajax(`${this.backendUri}/rooms`)
      .pipe(pluck("response"))

    this.currentRoomId$ = this.route.paramMap
      .pipe(
        map(({ params: { roomId } }: any) => roomId))
    // pluck("params", "roomId") alternative parameter destructuring

    this.currentRoomId$
      .pipe(
        tap(() => this.scrollToNewestMessage()),
        pairwise(),
        withLatestFrom(this.user$),
        filter(([[unused, _], user]) => Boolean(user)),
        map(([[before, after], { name }]) => { return { type: "room_change", before: before, after: after, user: name } })) // { name } is user object
      .subscribe(this.ws$);

    /*____________________________________________________________________ SEND MESSAGES WITH MEDIA START ____________________________________________________________________ */


    const sendMessageWithMedia = (formData: FormData) => ajax({
      url: `${this.backendUri}/message_with_media`,
      method: "POST",
      body: formData
    }).pipe(pluck("response"))

    const sendBtnObs$ =
      merge(onInputToSend$
        .pipe(
          filter((keyboardEvent: any) => keyboardEvent.keyCode === 13)
        ),
        onSendButtonClicked$);

    // messages without media
    sendBtnObs$.pipe(
      filter(() => R.compose(R.not, R.isEmpty)(this.sendInput?.nativeElement.value)),
      withLatestFrom(this.imgPreview$, this.user$, this.currentRoomId$, this.bahnConnections$), // img preview, bahnConnections
      filter(([_, imgs, __, ___, ____]: any) => !imgs.length),
      map(([_, __, user, roomdId, bahnConnections]: any) => { // append roomId from parameters to message, append img if uploaded
        return ({
          user: <string>user.name,
          message: <string>this.sendInput?.nativeElement.value,
          type: "message",
          room: roomdId + "",
          img: "",
          bahn_connections: bahnConnections
        } as Message)
      }),
      tap(() => {
        this.bahnConnections$.next(undefined)
        this.linkPreview$.next(undefined);
        localStorage.removeItem("savedMessage");
      })
    ).subscribe(this.ws$)

    // messages with media
    sendBtnObs$.pipe(
      withLatestFrom(this.imgPreview$, this.user$, this.currentRoomId$, this.bahnConnections$), // img preview, bahnConnections
      filter(([_, imgs, __, ___, ____]: any) => imgs.length),
      map(([_, imgs, user, roomdId, bahnConnections]: any) => { // append roomId from parameters to message, append img if uploaded
        const formData = new FormData()
        R.forEach((file: any) => formData.append('file', file.blob))(imgs)
        formData.append("message", JSON.stringify({
          user: user.name,
          message: <string>this.sendInput?.nativeElement.value,
          type: "message",
          room: roomdId + "",
          img: "",
          bahn_connections: bahnConnections
        }))
        return (formData)
      }),
      exhaustMap(sendMessageWithMedia),
      tap(() => {
        this.bahnConnections$.next(undefined)
        this.linkPreview$.next(undefined);
        localStorage.removeItem("savedMessage");
      })).subscribe(console.log)

    const clearInput = (id: string) => (<HTMLInputElement>window.document.getElementById(id)).value = ""


    const trace: (a: string) => OperatorFunction<any, any>
      = (prefix: string) => (source$: Observable<any>) => {
        source$.pipe(
          map(value => JSON.stringify(value)
          )
        ).subscribe(value => {
          console.log(`${prefix}: ${value}`)
          return of(value)
        })
        return of()
      }

    sendBtnObs$
      .pipe(
        tap(() => clearInput("textinput")),
        map(() => undefined))
      .subscribe({
        next: message => {
          this.scrollToNewestMessage()
          this.linkPreview$.next(message)
          this.typingStream$.next({});
          this.imgPreview$.next([])
        }
      })


    /*____________________________________________________________________ MESSAGEHANDLING START ____________________________________________________________________ */


    const messageHasUrl = (message: Message) => R.pipe(R.split(new RegExp(" ")), R.any(isUrl))(message.message)

    const linkPreviewFrom$ = (message: Message) => messageHasUrl(message)
      ? ajax(`http://api.linkpreview.net/?key=123456&q=${R.find(isUrl)(R.split(new RegExp(" "), message.message))}`)
        .pipe(
          pluck("response"),
          map((value: any) => {
            return {
              ...message,
              preview_image: value.image,
              preview_description: value.description
            } as Message
          })) : of(message)


    const procMessage: any = {
      "room_change": (message: Message) => [{ ...message, message: message.user + " has joined", room: message.after }, { ...message, message: message.user + " has left", room: message.before }],
      "message": (message: Message) => [message],
      "gif": (message: Message) => [message],
      "reaction": (message: Message) => [message]
    }

    const processMessage: (a: Message) => Message[] =
      (message: Message) => procMessage[message.type](message)

    // hot observable ws$ is mulitcasted
    this.ws$.pipe(
      filter(({ type }) => ["room_change", "message", "gif", "reaction"].includes(type)),
      withLatestFrom(this.typingStream$, this.user$),
      tap(([message, typingMessage, user]) => {
        if (message.user === typingMessage?.user && (typingMessage?.user !== user?.name)) {
          this.typingStream$.next({});
        }
      }),
      map(([fst]) => fst),
      concatMap(linkPreviewFrom$),
      map(processMessage),
      scan((accumulatedMessages: Message[], [fst]: Message[]) => {

        console.log()
        return fst.type === "reaction" ? R.map((message: Message) => {

          return message.id === fst.messageId ? ({ ...message, reaction: fst.reaction }) : message;
        })(accumulatedMessages) : [...accumulatedMessages, fst];
      }, []))
      .subscribe(this.messages$)

    this.messageInCurrentRoom$ = this.currentRoomId$
      .pipe(
        switchMap((roomId) => this.messages$.asObservable()
          .pipe(
            withLatestFrom(this.user$),
            map(([messages, user]) => {
              return messages.filter((message: Message) => (message.room == "" + roomId)).filter((message: Message) => (((message.type === "room_change") && !(message.user === user.name)) || (!(message.type === "room_change"))));
            }),
            map(messages => messages.map((message: Message) => { return message.type === "room_change" ? { ...message, user: "" } : message; }))
          ))
      )

    /*____________________________________________________________________ TYPING START ____________________________________________________________________ */

    /* swichtes for every new typing to a new timer of 1s.
     Returns false if the timer runs through */
    this.ws$.pipe(
      withLatestFrom(this.user$, this.currentRoomId$),
      filter(([message, user, roomId]) => message.type === "typing" && (user.name !== message.user) && (roomId == message.room)),
      tap(([message, _]) => this.typingStream$.next(message)),
      debounceTime(1000),
      map(() => ({})))
      .subscribe(this.typingStream$)

    // link preview
    const isUrl = (url: any) => url.match(/(http(s)?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/g)

    onInputToSend$
      .pipe(
        debounceTime(500),
        pluck("target", "value"),
        map((value: any) => R.trim(value)),
        distinctUntilChanged(),
        filter(R.compose(R.not, R.empty)),
        filter(isUrl),
        switchMap(url => ajax(`http://api.linkpreview.net/?key=123456&q=${url}`)
          .pipe(pluck("response"))
        )
      ).subscribe(this.linkPreview$)

    // save message when starting to type and send typing event
    onInputToSend$
      .pipe(
        filter(({ keyCode }: any) => keyCode !== 13), // we dont want enter to trigger typing events
        pluck("target", "value"),
        tap((value) => localStorage.setItem("savedMessage", value)),
        withLatestFrom(this.user$, this.currentRoomId$),
        map(([_, { name }, roomId]) => ({ "type": "typing", "user": name, "room": roomId })),
      ).subscribe(this.ws$)

    this.showSendButton$ = onInputToSend$
      .pipe(
        pluck("target", "value"),
        map(Boolean)
      )

    /*____________________________________________________________________ DRAGNDROP START ____________________________________________________________________ */

    const showUploadInput = () => {
      this.render2.setStyle(this.uploadInput?.nativeElement, "display", "block")
      this.render2.setStyle(this.sendInput?.nativeElement, "display", "none")
      this.render2.setStyle(this.uploadInput?.nativeElement, "height", "7em")
      this.render2.setStyle(this.uploadInput?.nativeElement, "border", "3px dotted green");
    }

    const hideUploadInputShowSendInput = () => {
      this.render2.setStyle(this.uploadInput?.nativeElement, "display", "none")
      this.render2.setStyle(this.sendInput?.nativeElement, "display", "block")
    }

    const modifyUploadInput = () => {
      this.render2.setStyle(this.uploadInput?.nativeElement, "height", "2em")
      this.render2.setStyle(this.uploadInput?.nativeElement, "border", "1px solid #ced4da")
    }

    fromEvent(this.sendInput?.nativeElement, "dragenter")
      .subscribe(() => {
        showUploadInput();
      })

    fromEvent(this.uploadInput?.nativeElement, "dragleave")
      .subscribe(() => {
        hideUploadInputShowSendInput();
        modifyUploadInput();
      })

    fromEvent(this.uploadInput?.nativeElement, "drop")
      .subscribe(() => {
        hideUploadInputShowSendInput();
        modifyUploadInput();
      })

    fromEvent(this.uploadInput?.nativeElement, "change")
      .pipe(
        pluck("target", "files"),
        tap(console.log),
        withLatestFrom(this.imgPreview$),
        map(([fileList, imgPreview]: any) => R.append({ blob: fileList.item(0)!, url: this.sanitizer.bypassSecurityTrustUrl(window.URL.createObjectURL(fileList.item(0)!)) })(imgPreview))
      )
      .subscribe({
        next: (item: any) => {
          this.uploadInput!.nativeElement.value = "";
          this.imgPreview$.next(item)
        },
        error: console.log,
        complete: () => console.log("complete")
      })

    //file upload drag and drop END

    // unread functionality start
    // we need to scan messages to incrementally add up the readMessages set
    const readMessages$ = new BehaviorSubject<Message[]>([]);

    this.currentRoomId$
      .pipe(
        withLatestFrom(this.messages$),
        map(([roomId, messages]) => R.filter((message: Message) => (message.type === "message")
          && (message.room === "" + roomId), messages)
        ),
        scan((acc: Message[], cur: Message[]) => R.uniqBy((elem: Message) => elem.id, [...acc, ...cur]))
      ).subscribe(readMessages$)


    this.messages$
      .asObservable()
      .pipe(
        withLatestFrom(readMessages$),
        map(([messages, readMessages]: any) => {
          const ids = R.map((msg: Message) => msg.id, readMessages)
          return R.filter((msg: Message) => !ids.includes(msg.id), messages)
        }),
        withLatestFrom(this.user$, this.currentRoomId$),
        map(([messages, user, roomId]) => R.filter((message: Message) => (message.user !== user.name) && (message.room !== roomId + ""), messages)),
        map(R.pipe(
          R.filter((message: Message) => (message.type === "message")),
          R.groupBy((elem: Message) => elem.room))
        )
      ).subscribe(this.unreadMessagesByRoom$)

    // unread functionality end

    /*____________________________________________________________________ DB START ____________________________________________________________________ */

    const locations$ = (name: string) => new Observable(o => {
      fetch(`https://api.deutschebahn.com/freeplan/v1/location/${name}`)
        .then(res => res.json())
        .then(res => {
          o.next(res); o.complete()
        }).catch(err => o.error(err))
    });

    const arrivals$ = (name: string) => (timestamp: string) => new Observable(o => {
      fetch(`https://api.deutschebahn.com/freeplan/v1/arrivalBoard/${name}?date=${timestamp}`)
        .then(res => res.json())
        .then(res => {
          o.next(res); o.complete()
        }).catch(err => o.error(err))
    });

    const departures$ = (id: number) => (timestamp: string) => new Observable(o => {
      fetch(`https://api.deutschebahn.com/freeplan/v1/departureBoard/${id}?date=${timestamp}`)
        .then(res => res.json())
        .then(res => {
          o.next(res); o.complete()
        }).catch(err => o.error(err))
    });

    const journeyDetails$ = (id: string) => new Observable(o => {
      fetch(`https://api.deutschebahn.com/freeplan/v1/journeyDetails/${id}`)
        .then(res => res.json())
        .then(res => {
          o.next(res); o.complete()
        }).catch(err => o.error(err))
    });


    const now = () => new Date(new Date().getTime() + (3_600_000 * 2)).toISOString()

    const arrivalOrDeparture$: any = {
      "Ankunft": (id: any) => (date: any) => arrivals$(id)(date),
      "Abfahrt": (id: any) => (date: any) => departures$(id)(date)
    }

    const withRetryConfig: RetryConfig = { count: 10, delay: 2500 }; // TODO use linear backoff

    const checkObsForStartString$ = (obs: Observable<any>) => (str: string) => onInputToSend$
      .pipe(
        pluck("target", "value"),
        map(input => input as string),
        filter(R.startsWith(str)))

    const checkInputForStr$ = checkObsForStartString$(onInputToSend$)

    checkInputForStr$("@bahn")
      .pipe(
        map(R.trim),
        distinctUntilChanged(),
        map(R.compose(R.drop(1), R.filter(R.compose(R.not, R.isEmpty)), R.split(" "))),
        map(value => value as string[]),
        filter(([first, second]: string[]) => R.compose(R.not, R.isNil)(second) && R.length(second) > 3 && R.has(first)(arrivalOrDeparture$)),
        debounceTime(500),
        switchMap(([type, stationName]: string[]) =>
          locations$(stationName).pipe(
            retry(withRetryConfig))
            .pipe(
              map(value => value as any[]),
              map(R.filter(({ name }: any) => R.startsWith(stationName)(name))),
              filter(R.compose(R.not, R.isEmpty)),
              // filter(R.compose(R.not, R.empty)),
              switchMap(([{ id }, _]) => arrivalOrDeparture$[type](id)(now())
                .pipe(
                  retry(withRetryConfig),
                  map(R.take(5)),
                  map(R.map(({ detailsId, ...arrivalOrDeparture }) => ({ ...arrivalOrDeparture, detailsId: encodeURIComponent(detailsId) }))),
                  mergeMap((values: any) => from(values)),
                  mergeMap(({ detailsId, track }) => zip(of(track), journeyDetails$(detailsId)
                    .pipe(
                      retry(withRetryConfig),
                      catchError(err => {
                        console.log("error with journeyDetails api");
                        return of([])
                      })
                    )
                  )),
                  map(([[intermediateStopTrack], [first, ...rest]]) => [intermediateStopTrack, R.find(({ stopName }) => R.startsWith(stationName)(stopName), [first, ...rest]), first, R.last(rest)]),
                  map(([fst, { depTime, arrTime, ...snd }, ...rest]) => [fst, { ...snd, timeShown: type === "Abfahrt" ? depTime : arrTime }, ...rest]),
                  take(5), // "force" completes stream
                  toArray(),
                )
              ))
        ),
        map(value => value as any[]),
        filter(R.compose(R.not, R.isEmpty)),
        map(R.compose(R.map(([intermediateStopTrack, stop, departure, arrival]) => `${stop.timeShown} ${stop.train} von ${departure.stopName} nach ${arrival.stopName} Gleis ${intermediateStopTrack}`)))
      )
      .subscribe(this.bahnConnections$)

    /*
    use inner switchmaps, if you want to access the content of e.g. parameters such as type or stationname, closure-like
    */

    /*____________________________________________________________________ @GIF START ____________________________________________________________________ */

    const buildGifUrl = (query: string) => (limit: number = 8) => (apiKey: string = "LIVDSRZULELA") => `https://g.tenor.com/v1/search?q=${query}&key=${apiKey}&limit=${limit}`

    checkInputForStr$("@gif").pipe(
      map(R.trim),
      distinctUntilChanged(),
      map(R.compose(R.drop(1), R.filter(R.compose(R.not, R.isEmpty)), R.split(" "))),
      filter(([first]: any) => R.compose(R.not, R.isNil)(first) && R.length(first) > 2),
      debounceTime(500),
      switchMap((query: string) => ajax(buildGifUrl(query)()())
        .pipe(
          pluck("response", "results")
        )
      )
    ).subscribe(this.gifs$)

    /*timer(5000, 5000).subscribe(console.log)
    interval(5000).subscribe(console.log);*/

    /*____________________________________________________________________ WEATHER START ____________________________________________________________________ */

    const weather$ = ([latitude, longitude]: any) => new Observable(o => {
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,relativehumidity_2m,windspeed_10m`)
        .then(res => res.json())
        .then(res => {
          o.next(res); o.complete()
        }).catch(err => o.error(err))
    });

    const coordsFromPc$ = (postalCode: string) => new Observable(o => {
      fetch(`https://public.opendatasoft.com/api/records/1.0/search/?dataset=georef-germany-postleitzahl&q=${postalCode}&facet=plz_name&facet=lan_name&facet=lan_code`)
        .then(res => res.json())
        .then(res => {
          o.next(res); o.complete()
        }).catch(err => o.error(err))
    });


    const locationObs$ = new Observable<GeolocationPosition>((o: any) => {
      navigator.geolocation.getCurrentPosition((location: GeolocationPosition) => { o.next(location); o.complete() },
        ((err: GeolocationPositionError) => o.error(err)))
    })

    const resolveLocation: any = {
      here: () => {
        return locationObs$
          .pipe(
            map(({ coords: { latitude, longitude } }) => [latitude, longitude]),
            map(() => ["55.0111", "10.58"]) // remove in production
          )
      },
      getCoords: (postalCode: any) => {
        // TODO fetch coords
        return coordsFromPc$(postalCode)
          .pipe(
            map(({ records: [{ geometry: { coordinates: [longitude, latitude] } }] }: any) => [latitude, longitude]));
      }
    }

    const sliceHours = (list: any) => R.slice(0, 24)(list)

    checkInputForStr$("@weather").pipe(
      map(R.trim),
      distinctUntilChanged(),
      map(R.compose(R.drop(1), R.filter(R.compose(R.not, R.isEmpty)), R.split(" "))),
      //tap(console.log),
      filter((place: any) => R.compose(R.not, R.isNil)(place)),
      debounceTime(600),
      switchMap((place) => resolveLocation[place] ? resolveLocation[place]() : resolveLocation["getCoords"](place)),
      concatMap(weather$),
      map(({ hourly_units, hourly: { time, temperature_2m } }: any) =>
        R.compose(
          R.map(([a, b]) => `${a} ${b}`),
          R.zip(
            R.compose(
              R.map((item: any) => R.drop(11)(item)),
              sliceHours)(time))
        )(R.compose(
          R.map((temp: any) => `${temp} ${hourly_units.temperature_2m}`),
          sliceHours)(temperature_2m)))
    ).subscribe(this.weatherPreview$)


    this.imgPreview$.subscribe(console.log)
  }

  /*____________________________________________________________________ UTIL METHODS START ____________________________________________________________________ */

  public sendGif({ media: [{ mediumgif: { preview } }] }: any) {
    this.user$
      .pipe(
        withLatestFrom(this.currentRoomId$),
        map(([{ name }, id]: any) => ({ type: "gif", gif: preview, user: name, room: id, message: "" } as Message)),
        tap(() => this.gifs$.next(undefined)))
      .subscribe(this.ws$)
  }

  public removeFile(img: any) {
    // TODO implement, remove file from imgpreview and removeObjectUrl

  }

  ngAfterContentInit(): void {
    console.log(this.messageElements)
  }

  public resolve(obj: any, key: any) {
    return obj ? obj[key] : null;
  }

  public scrollToNewestMessage = () => this.messageElements?.changes.subscribe((res: any) =>
    this.chat.nativeElement.lastElementChild?.scrollIntoView({ behavior: "smooth" }))

  destroy$: Subject<boolean> = new Subject<boolean>();

  //https://gist.githubusercontent.com/ChatonDeParis/9e0ca76837a479aaa9c2bda82d736d93/raw/5936ec219f3af92cfe6fbb2d7cfc60c4a3ac1df2/take-until.ts

  ngOnDestroy() {
    this.destroy$.next(true);
    this.destroy$.unsubscribe();
  }

  react = ([smiley, id]: any) => {
    this.ws$.next({ type: "reaction", messageId: id, reaction: smiley, message: "" })
    //this.ws$.next({})
  }
  smileys: any = {
    1: "https://images.vexels.com/media/users/3/134792/isolated/lists/11021ac040438214430837e55f4225b7-3d-laecheln-emoticon-emoji.png",
    2: "https://images.vexels.com/media/users/3/134534/isolated/preview/ff412bda84291044bf56d7ef069705e5-emoji-cooler-emoticon.png",
    3: "https://images.vexels.com/media/users/3/146887/isolated/lists/41faeb4b7129b75f4883d75c72627835-feuer-flamme-clipart.png",

  }

  Object = Object
}
